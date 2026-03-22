export interface GraphQLReviewNode {
	author: { login: string } | null;
	state: string;
}

export interface GraphQLReviewRequestNode {
	requestedReviewer:
		| { __typename: "User"; login: string; avatarUrl: string; url: string }
		| { __typename: "Team"; slug: string; url: string }
		| null;
}

export interface GraphQLPRNode {
	mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
	mergeStateStatus: string;
	reviews: {
		nodes: GraphQLReviewNode[];
	};
	reviewRequests: {
		nodes: GraphQLReviewRequestNode[];
	};
}

export interface GraphQLEnrichmentResponse {
	data: Record<string, Record<string, GraphQLPRNode>>;
	errors?: Array<{ message: string; path?: string[] }>;
}

/** Normalized data attached to each row as row._graphql */
export interface PREnrichmentData {
	mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
	mergeStateStatus: string;
	reviews: Array<{ login: string; state: string }>;
	reviewRequests: GraphQLReviewRequestNode["requestedReviewer"][];
}
