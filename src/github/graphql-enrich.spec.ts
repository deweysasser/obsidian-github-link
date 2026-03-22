import { test, describe, expect, beforeEach, jest } from "@jest/globals";

const mockedGraphqlRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock("./api", () => ({
	GitHubApi: jest.fn().mockImplementation(() => ({
		graphqlRequest: mockedGraphqlRequest,
	})),
}));

jest.mock("../plugin", () => ({
	logger: { debug: jest.fn() },
	PluginSettings: {
		accounts: [{ id: "default", token: "test-token", orgs: ["myorg"] }],
		defaultAccount: "default",
	},
}));

import { enrichPRsWithGraphQL } from "./graphql-enrich";
import type { TableResult } from "../query/types";
import type { PREnrichmentData } from "./graphql-types";

function makeRow(overrides: Record<string, unknown> = {}): TableResult[number] {
	return {
		number: 42,
		html_url: "https://github.com/myorg/myrepo/pull/42",
		user: null,
		labels: [],
		state: "open",
		created_at: "",
		updated_at: "",
		closed_at: null,
		assignee: null,
		...overrides,
	} as unknown as TableResult[number];
}

describe("enrichPRsWithGraphQL", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test("skips enrichment when no enrichable columns are requested", async () => {
		const rows = [makeRow()] as unknown as TableResult;
		await enrichPRsWithGraphQL(rows, ["number", "title"], "myorg");
		expect(mockedGraphqlRequest).not.toHaveBeenCalled();
	});

	test("skips enrichment when no token is available", async () => {
		// Temporarily override PluginSettings to have no accounts
		const plugin = jest.requireMock("../plugin") as { PluginSettings: { accounts: unknown[]; defaultAccount: string } };
		const origAccounts = plugin.PluginSettings.accounts;
		const origDefault = plugin.PluginSettings.defaultAccount;
		plugin.PluginSettings.accounts = [];
		plugin.PluginSettings.defaultAccount = "";

		const rows = [makeRow()] as unknown as TableResult;
		await enrichPRsWithGraphQL(rows, ["conflicts"], "unknown-org");
		expect(mockedGraphqlRequest).not.toHaveBeenCalled();

		plugin.PluginSettings.accounts = origAccounts;
		plugin.PluginSettings.defaultAccount = origDefault;
	});

	test("attaches _graphql data to rows on successful response", async () => {
		mockedGraphqlRequest.mockResolvedValue({
			data: {
				r0: {
					pr42: {
						mergeable: "MERGEABLE",
						mergeStateStatus: "CLEAN",
						reviews: {
							nodes: [
								{ author: { login: "alice" }, state: "APPROVED" },
								{ author: { login: "bob" }, state: "CHANGES_REQUESTED" },
							],
						},
						reviewRequests: {
							nodes: [
								{
									requestedReviewer: {
										__typename: "User",
										login: "charlie",
										avatarUrl: "https://avatars.com/charlie",
										url: "https://github.com/charlie",
									},
								},
							],
						},
					},
				},
			},
		});

		const row = makeRow();
		const rows = [row] as unknown as TableResult;
		await enrichPRsWithGraphQL(rows, ["conflicts", "reviews"], "myorg");

		const gql = (row as Record<string, unknown>)._graphql as PREnrichmentData;
		expect(gql).toBeDefined();
		expect(gql.mergeable).toEqual("MERGEABLE");
		expect(gql.mergeStateStatus).toEqual("CLEAN");
		expect(gql.reviews).toHaveLength(2);
		expect(gql.reviews[0]).toEqual({ login: "alice", state: "APPROVED" });
		expect(gql.reviewRequests).toHaveLength(1);
	});

	test("handles multiple PRs across multiple repos", async () => {
		const row1 = makeRow({ number: 10, html_url: "https://github.com/myorg/repo1/pull/10" });
		const row2 = makeRow({ number: 20, html_url: "https://github.com/myorg/repo2/pull/20" });

		mockedGraphqlRequest.mockResolvedValue({
			data: {
				r0: {
					pr10: {
						mergeable: "CONFLICTING",
						mergeStateStatus: "DIRTY",
						reviews: { nodes: [] },
						reviewRequests: { nodes: [] },
					},
				},
				r1: {
					pr20: {
						mergeable: "UNKNOWN",
						mergeStateStatus: "UNKNOWN",
						reviews: { nodes: [] },
						reviewRequests: { nodes: [] },
					},
				},
			},
		});

		const rows = [row1, row2] as unknown as TableResult;
		await enrichPRsWithGraphQL(rows, ["mergeable"], "myorg");

		const gql1 = (row1 as Record<string, unknown>)._graphql as PREnrichmentData;
		const gql2 = (row2 as Record<string, unknown>)._graphql as PREnrichmentData;
		expect(gql1.mergeable).toEqual("CONFLICTING");
		expect(gql2.mergeable).toEqual("UNKNOWN");
	});

	test("gracefully handles GraphQL errors without crashing", async () => {
		mockedGraphqlRequest.mockRejectedValue(new Error("GraphQL error"));

		const row = makeRow();
		const rows = [row] as unknown as TableResult;
		await enrichPRsWithGraphQL(rows, ["conflicts"], "myorg");

		expect((row as Record<string, unknown>)._graphql).toBeUndefined();
	});

	test("handles response with errors and no data", async () => {
		mockedGraphqlRequest.mockResolvedValue({
			errors: [{ message: "Something went wrong" }],
		});

		const row = makeRow();
		const rows = [row] as unknown as TableResult;
		await enrichPRsWithGraphQL(rows, ["conflicts"], "myorg");

		expect((row as Record<string, unknown>)._graphql).toBeUndefined();
	});

	test("handles partial response where some PRs are missing", async () => {
		const row1 = makeRow({ number: 10, html_url: "https://github.com/myorg/myrepo/pull/10" });
		const row2 = makeRow({ number: 20, html_url: "https://github.com/myorg/myrepo/pull/20" });

		mockedGraphqlRequest.mockResolvedValue({
			data: {
				r0: {
					pr10: {
						mergeable: "MERGEABLE",
						mergeStateStatus: "CLEAN",
						reviews: { nodes: [] },
						reviewRequests: { nodes: [] },
					},
				},
			},
		});

		const rows = [row1, row2] as unknown as TableResult;
		await enrichPRsWithGraphQL(rows, ["conflicts"], "myorg");

		expect((row1 as Record<string, unknown>)._graphql).toBeDefined();
		expect((row2 as Record<string, unknown>)._graphql).toBeUndefined();
	});

	test("skips rows without parseable org/repo/number", async () => {
		const row = makeRow({ html_url: "https://example.com/something" });
		const rows = [row] as unknown as TableResult;
		await enrichPRsWithGraphQL(rows, ["conflicts"], "myorg");
		expect(mockedGraphqlRequest).not.toHaveBeenCalled();
	});

	test("normalizes reviews by filtering null authors", async () => {
		mockedGraphqlRequest.mockResolvedValue({
			data: {
				r0: {
					pr42: {
						mergeable: "MERGEABLE",
						mergeStateStatus: "CLEAN",
						reviews: {
							nodes: [
								{ author: null, state: "APPROVED" },
								{ author: { login: "alice" }, state: "APPROVED" },
							],
						},
						reviewRequests: { nodes: [] },
					},
				},
			},
		});

		const row = makeRow();
		const rows = [row] as unknown as TableResult;
		await enrichPRsWithGraphQL(rows, ["reviews"], "myorg");

		const gql = (row as Record<string, unknown>)._graphql as PREnrichmentData;
		expect(gql.reviews).toHaveLength(1);
		expect(gql.reviews[0].login).toEqual("alice");
	});
});
