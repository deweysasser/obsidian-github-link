import { test, describe, expect, beforeAll, beforeEach, jest } from "@jest/globals";
import { elementTestSetup } from "../../../test/element";

// Mock dependencies before importing the module under test
jest.mock("../../github/github");
jest.mock("../../plugin", () => ({
	logger: { debug: jest.fn() },
	PluginSettings: { accounts: [], defaultAccount: "" },
}));

// Obsidian monkeypatches HTMLElement with createEl/createDiv/createSpan
function patchHTMLElement() {
	HTMLElement.prototype.createEl = function <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		o?: DomElementInfo | string,
	): HTMLElementTagNameMap[K] {
		const el = window.createEl(tag, o);
		this.appendChild(el);
		return el;
	};
	HTMLElement.prototype.createDiv = function (o?: DomElementInfo | string) {
		return this.createEl("div", o);
	};
	HTMLElement.prototype.createSpan = function (o?: DomElementInfo | string) {
		return this.createEl("span", o);
	};
}

import { PullRequestColumns } from "./pull-request";
import { getPullRequest, getReviewsForPR } from "../../github/github";
import type { PullResponse, PullReviewListResponse } from "../../github/response";
import type { TableResult } from "../types";

const mockedGetPullRequest = getPullRequest as jest.MockedFunction<typeof getPullRequest>;
const mockedGetReviewsForPR = getReviewsForPR as jest.MockedFunction<typeof getReviewsForPR>;

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

function makeCell(): HTMLTableCellElement {
	return document.createElement("td");
}

describe("PullRequestColumns", () => {
	beforeAll(() => {
		elementTestSetup();
		patchHTMLElement();
	});

	beforeEach(() => {
		jest.resetAllMocks();
	});

	describe("getOrgRepoNumber (via column cells)", () => {
		test("parses org/repo/number from html_url for a PR", async () => {
			mockedGetPullRequest.mockResolvedValue({ mergeable: true, mergeable_state: "clean" } as PullResponse);
			const cell = makeCell();
			await PullRequestColumns.conflicts.cell(makeRow(), cell);
			expect(mockedGetPullRequest).toHaveBeenCalledWith("myorg", "myrepo", 42);
		});

		test("parses org/repo/number from repository_url", async () => {
			mockedGetPullRequest.mockResolvedValue({ mergeable: true, mergeable_state: "clean" } as PullResponse);
			const cell = makeCell();
			const row = makeRow({
				html_url: "https://github.com/myorg/myrepo/pull/42",
				repository_url: "https://api.github.com/repos/fromapi/apirepo",
			});
			await PullRequestColumns.conflicts.cell(row, cell);
			expect(mockedGetPullRequest).toHaveBeenCalledWith("fromapi", "apirepo", 42);
		});

		test("returns null for issue URLs (not PR)", async () => {
			const cell = makeCell();
			const row = makeRow({ html_url: "https://github.com/myorg/myrepo/issues/42" });
			await PullRequestColumns.conflicts.cell(row, cell);
			expect(mockedGetPullRequest).not.toHaveBeenCalled();
			expect(cell.innerText).toEqual("-");
		});

		test("returns null for non-GitHub URLs", async () => {
			const cell = makeCell();
			const row = makeRow({ html_url: "https://example.com/something" });
			await PullRequestColumns.conflicts.cell(row, cell);
			expect(mockedGetPullRequest).not.toHaveBeenCalled();
			expect(cell.innerText).toEqual("-");
		});
	});

	describe("review_comments", () => {
		test("uses review_comments field from row when available", async () => {
			const cell = makeCell();
			const row = makeRow({ review_comments: 5 });
			await PullRequestColumns.review_comments.cell(row, cell);
			expect(cell.innerText).toEqual("5");
			expect(mockedGetPullRequest).not.toHaveBeenCalled();
		});

		test("displays 0 when review_comments is 0", async () => {
			const cell = makeCell();
			const row = makeRow({ review_comments: 0 });
			await PullRequestColumns.review_comments.cell(row, cell);
			expect(cell.innerText).toEqual("0");
		});

		test("fetches from PR detail when field is missing", async () => {
			mockedGetPullRequest.mockResolvedValue({ review_comments: 3 } as PullResponse);
			const cell = makeCell();
			await PullRequestColumns.review_comments.cell(makeRow(), cell);
			expect(cell.innerText).toEqual("3");
		});

		test("shows dash on API error", async () => {
			mockedGetPullRequest.mockRejectedValue(new Error("rate limited"));
			const cell = makeCell();
			await PullRequestColumns.review_comments.cell(makeRow(), cell);
			expect(cell.innerText).toEqual("-");
		});
	});

	describe("reviews", () => {
		function makeReview(login: string | null, state: string) {
			return {
				user: login ? { login } : null,
				state,
			};
		}

		test("shows None when no actionable reviews exist", async () => {
			mockedGetReviewsForPR.mockResolvedValue([] as unknown as PullReviewListResponse);
			const cell = makeCell();
			await PullRequestColumns.reviews.cell(makeRow(), cell);
			expect(cell.innerText).toEqual("None");
		});

		test("computes latest state per reviewer", async () => {
			mockedGetReviewsForPR.mockResolvedValue([
				makeReview("alice", "CHANGES_REQUESTED"),
				makeReview("alice", "APPROVED"),
				makeReview("bob", "APPROVED"),
			] as unknown as PullReviewListResponse);
			const cell = makeCell();
			await PullRequestColumns.reviews.cell(makeRow(), cell);
			expect(cell.innerText).toEqual("2 Approved");
		});

		test("shows multiple states", async () => {
			mockedGetReviewsForPR.mockResolvedValue([
				makeReview("alice", "APPROVED"),
				makeReview("bob", "CHANGES_REQUESTED"),
			] as unknown as PullReviewListResponse);
			const cell = makeCell();
			await PullRequestColumns.reviews.cell(makeRow(), cell);
			expect(cell.innerText).toContain("1 Approved");
			expect(cell.innerText).toContain("1 Changes requested");
		});

		test("filters out COMMENTED reviews", async () => {
			mockedGetReviewsForPR.mockResolvedValue([
				makeReview("alice", "COMMENTED"),
			] as unknown as PullReviewListResponse);
			const cell = makeCell();
			await PullRequestColumns.reviews.cell(makeRow(), cell);
			expect(cell.innerText).toEqual("None");
		});

		test("filters out PENDING reviews", async () => {
			mockedGetReviewsForPR.mockResolvedValue([
				makeReview("alice", "PENDING"),
			] as unknown as PullReviewListResponse);
			const cell = makeCell();
			await PullRequestColumns.reviews.cell(makeRow(), cell);
			expect(cell.innerText).toEqual("None");
		});

		test("skips reviews from null users", async () => {
			mockedGetReviewsForPR.mockResolvedValue([
				makeReview(null, "APPROVED"),
				makeReview("alice", "APPROVED"),
			] as unknown as PullReviewListResponse);
			const cell = makeCell();
			await PullRequestColumns.reviews.cell(makeRow(), cell);
			expect(cell.innerText).toEqual("1 Approved");
		});

		test("shows dash on API error", async () => {
			mockedGetReviewsForPR.mockRejectedValue(new Error("fail"));
			const cell = makeCell();
			await PullRequestColumns.reviews.cell(makeRow(), cell);
			expect(cell.innerText).toEqual("-");
		});
	});

	describe("conflicts", () => {
		test("shows No when mergeable is true", async () => {
			mockedGetPullRequest.mockResolvedValue({ mergeable: true } as PullResponse);
			const cell = makeCell();
			await PullRequestColumns.conflicts.cell(makeRow(), cell);
			expect(cell.innerText).toEqual("No");
		});

		test("shows Yes when mergeable is false", async () => {
			mockedGetPullRequest.mockResolvedValue({ mergeable: false } as PullResponse);
			const cell = makeCell();
			await PullRequestColumns.conflicts.cell(makeRow(), cell);
			expect(cell.innerText).toEqual("Yes");
		});

		test("shows dash when mergeable is null", async () => {
			mockedGetPullRequest.mockResolvedValue({ mergeable: null } as unknown as PullResponse);
			const cell = makeCell();
			await PullRequestColumns.conflicts.cell(makeRow(), cell);
			expect(cell.innerText).toEqual("-");
		});
	});

	describe("mergeable", () => {
		test.each([
			{ state: "clean", expected: "Clean" },
			{ state: "dirty", expected: "Dirty" },
			{ state: "blocked", expected: "Blocked" },
			{ state: "unstable", expected: "Unstable" },
			{ state: "behind", expected: "Behind" },
			{ state: "unknown", expected: "Unknown" },
		])("displays $state as $expected", async ({ state, expected }) => {
			mockedGetPullRequest.mockResolvedValue({ mergeable_state: state } as PullResponse);
			const cell = makeCell();
			await PullRequestColumns.mergeable.cell(makeRow(), cell);
			expect(cell.innerText).toEqual(expected);
		});

		test("shows dash when mergeable_state is empty", async () => {
			mockedGetPullRequest.mockResolvedValue({ mergeable_state: "" } as PullResponse);
			const cell = makeCell();
			await PullRequestColumns.mergeable.cell(makeRow(), cell);
			expect(cell.innerText).toEqual("-");
		});
	});

	describe("requested_reviewers", () => {
		test("renders user reviewers from row data", async () => {
			mockedGetReviewsForPR.mockResolvedValue([] as unknown as PullReviewListResponse);
			const cell = makeCell();
			const row = makeRow({
				requested_reviewers: [
					{ login: "alice", html_url: "https://github.com/alice", avatar_url: "https://avatars.com/alice" },
				],
			});
			await PullRequestColumns.requested_reviewers.cell(row, cell);
			const anchor = cell.querySelector("a");
			expect(anchor).toBeTruthy();
			expect(anchor?.querySelector("span")?.innerText).toEqual("alice");
		});

		test("renders team reviewers from requested_teams", async () => {
			mockedGetReviewsForPR.mockResolvedValue([] as unknown as PullReviewListResponse);
			const cell = makeCell();
			const row = makeRow({
				requested_reviewers: [],
				requested_teams: [
					{ slug: "frontend", html_url: "https://github.com/orgs/myorg/teams/frontend" },
				],
			});
			await PullRequestColumns.requested_reviewers.cell(row, cell);
			const anchor = cell.querySelector("a");
			expect(anchor).toBeTruthy();
			expect(anchor?.querySelector("span")?.innerText).toEqual("frontend");
			expect(anchor?.getAttribute("href")).toEqual("https://github.com/orgs/myorg/teams/frontend");
		});

		test("renders both users and teams together", async () => {
			mockedGetReviewsForPR.mockResolvedValue([] as unknown as PullReviewListResponse);
			const cell = makeCell();
			const row = makeRow({
				requested_reviewers: [
					{ login: "alice", html_url: "https://github.com/alice" },
				],
				requested_teams: [
					{ slug: "backend", html_url: "https://github.com/orgs/myorg/teams/backend" },
				],
			});
			await PullRequestColumns.requested_reviewers.cell(row, cell);
			const anchors = cell.querySelectorAll("a");
			expect(anchors.length).toEqual(2);
		});

		test("shows dash when no reviewers or teams and no reviews", async () => {
			mockedGetReviewsForPR.mockResolvedValue([] as unknown as PullReviewListResponse);
			const cell = makeCell();
			const row = makeRow({ requested_reviewers: [], requested_teams: [] });
			await PullRequestColumns.requested_reviewers.cell(row, cell);
			expect(cell.innerText).toEqual("-");
		});

		test("includes reviewers who already submitted reviews", async () => {
			mockedGetReviewsForPR.mockResolvedValue([
				{ user: { login: "gwu-actblue", html_url: "https://github.com/gwu-actblue" }, state: "APPROVED" },
			] as unknown as PullReviewListResponse);
			const cell = makeCell();
			const row = makeRow({ requested_reviewers: [], requested_teams: [] });
			await PullRequestColumns.requested_reviewers.cell(row, cell);
			const anchor = cell.querySelector("a");
			expect(anchor).toBeTruthy();
			expect(anchor?.querySelector("span")?.innerText).toEqual("gwu-actblue");
		});

		test("deduplicates reviewers who are both pending and have reviewed", async () => {
			mockedGetReviewsForPR.mockResolvedValue([
				{ user: { login: "alice", html_url: "https://github.com/alice" }, state: "APPROVED" },
			] as unknown as PullReviewListResponse);
			const cell = makeCell();
			const row = makeRow({
				requested_reviewers: [
					{ login: "alice", html_url: "https://github.com/alice" },
				],
			});
			await PullRequestColumns.requested_reviewers.cell(row, cell);
			const anchors = cell.querySelectorAll("a");
			expect(anchors.length).toEqual(1);
		});

		test("fetches from PR detail when fields are missing", async () => {
			mockedGetPullRequest.mockResolvedValue({
				requested_reviewers: [
					{ login: "bob", html_url: "https://github.com/bob" },
				],
				requested_teams: [],
			} as unknown as PullResponse);
			mockedGetReviewsForPR.mockResolvedValue([] as unknown as PullReviewListResponse);
			const cell = makeCell();
			await PullRequestColumns.requested_reviewers.cell(makeRow(), cell);
			expect(mockedGetPullRequest).toHaveBeenCalled();
			const anchor = cell.querySelector("a");
			expect(anchor?.querySelector("span")?.innerText).toEqual("bob");
		});
	});
});
