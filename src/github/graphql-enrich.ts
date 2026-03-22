import { GitHubApi } from "./api";
import { PluginSettings, logger } from "../plugin";
import { getOrgRepoNumber } from "../query/column/utils";
import type { TableResult } from "../query/types";
import type { GraphQLEnrichmentResponse, GraphQLPRNode, PREnrichmentData } from "./graphql-types";

const ENRICHABLE_COLUMNS = ["reviews", "conflicts", "mergeable", "requested_reviewers"];

const api = new GitHubApi();

function getToken(org?: string): string | undefined {
	const account =
		PluginSettings.accounts.find((acc) => acc.orgs.some((savedOrg) => savedOrg === org)) ??
		PluginSettings.accounts.find((acc) => acc.id === PluginSettings.defaultAccount);
	return account?.token;
}

function buildGraphQLQuery(
	grouped: Map<string, Map<string, { row: TableResult[number]; number: number }>>,
): string {
	const parts: string[] = [];
	let repoIdx = 0;
	for (const [repoKey, prs] of grouped) {
		const [owner, name] = repoKey.split("/");
		const prFragments: string[] = [];
		for (const [, { number }] of prs) {
			prFragments.push(`
      pr${number}: pullRequest(number: ${number}) {
        mergeable
        mergeStateStatus
        reviews(last: 100) {
          nodes {
            author { login }
            state
          }
        }
        reviewRequests(first: 50) {
          nodes {
            requestedReviewer {
              ... on User { __typename login avatarUrl url }
              ... on Team { __typename slug url }
            }
          }
        }
      }`);
		}
		parts.push(`  r${repoIdx}: repository(owner: "${owner}", name: "${name}") {\n${prFragments.join("\n")}\n  }`);
		repoIdx++;
	}
	return `query PREnrichment {\n${parts.join("\n")}\n}`;
}

function normalizePRNode(node: GraphQLPRNode): PREnrichmentData {
	const reviews: PREnrichmentData["reviews"] = [];
	for (const r of node.reviews.nodes) {
		if (r.author?.login) {
			reviews.push({ login: r.author.login, state: r.state });
		}
	}
	return {
		mergeable: node.mergeable,
		mergeStateStatus: node.mergeStateStatus,
		reviews,
		reviewRequests: node.reviewRequests.nodes.map((n) => n.requestedReviewer),
	};
}

/**
 * Starts GraphQL enrichment and attaches a shared promise to each row.
 * Does NOT block — callers should not await this. Renderers await row._graphqlPromise.
 */
export function enrichPRsWithGraphQL(
	rows: TableResult,
	columns: string[],
	org?: string,
): void {
	// Only enrich if relevant columns are requested
	if (!columns.some((c) => ENRICHABLE_COLUMNS.includes(c.toLowerCase()))) {
		return;
	}

	const token = getToken(org);
	if (!token) {
		return;
	}

	// Group rows by org/repo
	const grouped = new Map<string, Map<string, { row: TableResult[number]; number: number }>>();
	for (const row of rows) {
		const info = getOrgRepoNumber(row);
		if (!info) continue;
		const repoKey = `${info.org}/${info.repo}`;
		if (!grouped.has(repoKey)) {
			grouped.set(repoKey, new Map());
		}
		const prKey = `${repoKey}/${info.number}`;
		grouped.get(repoKey)!.set(prKey, { row, number: info.number });
	}

	if (grouped.size === 0) {
		return;
	}

	// Start the fetch — don't await
	const promise = fetchAndAttach(grouped, token);

	// Attach the promise to every enrichable row so renderers can await it
	for (const [, prs] of grouped) {
		for (const [, { row }] of prs) {
			(row as Record<string, unknown>)._graphqlPromise = promise;
		}
	}
}

async function fetchAndAttach(
	grouped: Map<string, Map<string, { row: TableResult[number]; number: number }>>,
	token: string,
): Promise<void> {
	try {
		const query = buildGraphQLQuery(grouped);
		const response = (await api.graphqlRequest(query, token)) as GraphQLEnrichmentResponse;

		if (!response.data) {
			if (response.errors) {
				logger.debug(`GraphQL enrichment errors: ${JSON.stringify(response.errors)}`);
			}
			return;
		}

		// Walk response and attach data to rows
		let repoIdx = 0;
		for (const [, prs] of grouped) {
			const repoData = response.data[`r${repoIdx}`];
			if (!repoData) {
				repoIdx++;
				continue;
			}
			for (const [, { row, number }] of prs) {
				const prData = repoData[`pr${number}`];
				if (prData) {
					(row as Record<string, unknown>)._graphql = normalizePRNode(prData);
				}
			}
			repoIdx++;
		}
	} catch (err) {
		logger.debug(`GraphQL enrichment failed, falling back to REST: ${err}`);
	}
}
