/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { parseUrl, repoAPIToBrowserUrl } from "../../github/url-parse";

import { DateFormat } from "../../util";
import type { IssueListResponse, UserResponse } from "../../github/response";
import type { TableResult } from "../types";

export interface ColumnGetter<T> {
	header: string;
	cell: (row: T, el: HTMLTableCellElement) => void | Promise<void>;
	sortValue?: (row: T) => string | number | null;
}
export type ColumnsMap = Record<string, ColumnGetter<TableResult[number]>>;

export function DateCell(value: string | undefined | null, el: HTMLTableCellElement) {
	el.classList.add("github-link-table-date");
	if (!value) {
		return;
	}

	const asDate = new Date(value);
	if (isNaN(asDate.valueOf())) {
		el.setText(value);
		return;
	}

	// TODO: Allow formatting this date via options.
	el.setText(DateFormat.DATE_SHORT.format(asDate));
}

export function UserCell(user: UserResponse, el: HTMLElement): void {
	const anchor = el.createEl("a", {
		cls: "github-link-table-author",
		href: user?.html_url ?? "#",
		attr: { target: "_blank" },
	});
	if (user?.avatar_url) {
		anchor.createEl("img", { cls: "github-link-table-avatar", attr: { src: user.avatar_url } });
	}
	anchor.createSpan({ text: user?.login });
}

/**
 * Issue and PR columns share types, so some columns are shared
 */
export const CommonIssuePRColumns: ColumnsMap = {
	number: {
		header: "Number",
		sortValue: (row) => row.number,
		cell: (row, el) => {
			el.classList.add("github-link-table-issue-number");
			el.createEl("a", { text: `#${row.number}`, href: row.html_url, attr: { target: "_blank" } });
		},
	},
	repo: {
		header: "Repo",
		sortValue: (row) => {
			const url = repoAPIToBrowserUrl((row as IssueListResponse[number]).repository_url);
			const parsed = parseUrl(url);
			return parsed?.repo ?? null;
		},
		cell: (row, el) => {
			el.classList.add("github-link-table-repo");
			const url = repoAPIToBrowserUrl((row as IssueListResponse[number]).repository_url);
			const parsed = parseUrl(url);
			el.createEl("a", { text: parsed?.repo ?? "Repo", href: url, attr: { target: "_blank" } });
		},
	},
	author: {
		header: "Author",
		sortValue: (row) => row.user?.login ?? null,
		cell: (row, el) => {
			UserCell(row.user, el);
		},
	},
	assignee: {
		header: "Assignee",
		sortValue: (row) => row.assignee?.login ?? null,
		cell: (row, el) => {
			UserCell(row.assignee, el);
		},
	},
	created: {
		header: "Created",
		sortValue: (row) => row.created_at ?? null,
		cell: (row, el) => {
			DateCell(row.created_at, el);
		},
	},
	updated: {
		header: "Updated",
		sortValue: (row) => row.updated_at ?? null,
		cell: (row, el) => {
			DateCell(row.updated_at, el);
		},
	},
	closed: {
		header: "Closed",
		sortValue: (row) => row.closed_at ?? null,
		cell: (row, el) => {
			DateCell(row.closed_at, el);
		},
	},
	labels: {
		header: "Labels",
		sortValue: (row) => {
			const names = (row.labels ?? [])
				.map((l) => (typeof l === "string" ? l : l.name ?? ""))
				.filter(Boolean);
			return names.length > 0 ? names.join(", ") : null;
		},
		cell: (row, el) => {
			const wrapper = el.createDiv({ cls: "github-link-table-labels" });
			for (const label of row.labels ?? []) {
				// When would the label just be a string?
				if (typeof label !== "string") {
					const labelEl = wrapper.createSpan({
						cls: "github-link-table-label",
						text: label.name,
					});
					if (label.color) {
						labelEl.style.setProperty("--status-color", `#${label.color}`);
					}
				}
			}
		},
	},
};
