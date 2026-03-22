import { parseYaml, setIcon } from "obsidian";
import {
	searchIssues,
	getIssuesForRepo,
	getMyIssues,
	getPullRequestsForRepo,
	getIssuesForOrganization,
} from "../github/github";
import type { MaybePaginated, PaginationMeta } from "../github/response";
import { PluginSettings } from "../plugin";
import { getProp, isEqual, titleCase } from "../util";
import { ALL_COLUMNS, DEFAULT_COLUMNS } from "./column/defaults";
import { enrichPRsWithGraphQL } from "../github/graphql-enrich";
import type { ColumnGetter } from "./column/base";
import type { QueryParams, TableResult } from "./types";
import { OutputType, QueryType } from "./types";

export class GithubQuery {
	private params!: QueryParams;
	private result: TableResult | null = null;
	private resultMeta: PaginationMeta | null = null;
	private sortColumns: Array<{ column: string; direction: "asc" | "desc" }> = [];

	constructor(private readonly hostElement: HTMLElement) {}

	public async init(source: string): Promise<void> {
		const parsedParams = this.parseCodeblock(source);
		if (!parsedParams) {
			console.error(`Github Link: simplistic parsing failed`);
		} else {
			await this.setParams(parsedParams);
		}
	}

	/**
	 * Setting the parameters triggers calling the API
	 */
	private static parseClientSort(value: string): Array<{ column: string; direction: "asc" | "desc" }> {
		return value
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
			.map((part) => {
				const [col, dir] = part.split(/\s+/);
				return {
					column: col.toLowerCase(),
					direction: (dir?.toLowerCase() === "desc" ? "desc" : "asc") as "asc" | "desc",
				};
			});
	}

	public async setParams(newParams: QueryParams = this.params, forceUpdate = false): Promise<void> {
		const currentParams = this.params;
		this.params = newParams;
		if (!currentParams && newParams.clientSort) {
			this.sortColumns = GithubQuery.parseClientSort(newParams.clientSort);
		}
		if (forceUpdate || !isEqual(currentParams, newParams)) {
			const result = await this.executeQuery(forceUpdate);
			if (result) {
				if (this.params.queryType === QueryType.PullRequest) {
					enrichPRsWithGraphQL(result.response, this.params.columns ?? [], this.params.org);
				}
				this.setResult(result.response, result.meta);
			}
		}
	}

	public setResult(result: TableResult, meta: PaginationMeta): void {
		this.result = result;
		this.resultMeta = meta;
		this.render();
	}

	public parseCodeblock(source: string): QueryParams | null {
		let params: QueryParams | null;
		try {
			params = parseYaml(source) as QueryParams;
		} catch (e) {
			console.error(`Github Link: YAML Parsing failed, attempting simplistic parsing`);
			console.error(e);
			params = Object.fromEntries(source.split("\n").map((l) => l.split(/:\s?/))) as QueryParams;
		}
		return params ?? null;
	}

	public async executeQuery(skipCache = false): Promise<MaybePaginated<TableResult> | null> {
		const params = this.params;
		if (params.outputType === OutputType.Table) {
			// Custom Query
			if (params.query && (params.queryType === QueryType.Issue || params.queryType === QueryType.PullRequest)) {
				const { meta, response } = await searchIssues(params, params.query, params.org, skipCache);
				return { meta, response: response.items };
			}
			// Issue query with org and repo provided
			else if (params.queryType === QueryType.Issue && params.org && params.repo) {
				return await getIssuesForRepo(params, params.org, params.repo, skipCache);
			}
			// Issue query with only org provided
			else if (params.queryType === QueryType.Issue && params.org) {
				// TODO: Handle error case here if provided org cannot be found
				return await getIssuesForOrganization(params, params.org, skipCache);
			}
			// Issue query without org or repo provided
			else if (params.queryType === QueryType.Issue) {
				return await getMyIssues(params, params.org, skipCache);
			}
			// Pull request query with org and repo provided
			else if (params.queryType === QueryType.PullRequest && params.org && params.repo) {
				return await getPullRequestsForRepo(params, params.org, params.repo, skipCache);
			}
		}
		return null;
	}

	private sortResult(): void {
		if (!this.result || this.sortColumns.length === 0) return;

		const queryType = this.params.queryType;
		const columnDefs = ALL_COLUMNS[queryType];

		this.result.sort((a: TableResult[number], b: TableResult[number]) => {
			for (const { column, direction } of this.sortColumns) {
				const def = columnDefs[column] as ColumnGetter<TableResult[number]> | undefined;
				let aVal: unknown;
				let bVal: unknown;

				if (def?.sortValue) {
					aVal = def.sortValue(a);
					bVal = def.sortValue(b);
				} else {
					aVal = getProp(a as unknown as Record<string, unknown>, column);
					bVal = getProp(b as unknown as Record<string, unknown>, column);
				}

				// Nulls sort last regardless of direction
				const aNull = aVal == null;
				const bNull = bVal == null;
				if (aNull && bNull) continue;
				if (aNull) return 1;
				if (bNull) return -1;

				let cmp = 0;
				if (typeof aVal === "number" && typeof bVal === "number") {
					cmp = aVal - bVal;
				} else {
					cmp = String(aVal).localeCompare(String(bVal), undefined, { sensitivity: "base" });
				}

				if (cmp !== 0) {
					return direction === "desc" ? -cmp : cmp;
				}
			}
			return 0;
		});
	}

	public render(): void {
		if (!this.result) {
			throw new Error("Attempted to render table before there was a result.");
		}

		this.sortResult();
		this.hostElement.empty();
		const tableWrapper = this.hostElement.createDiv({ cls: "github-link-table-wrapper" });
		const tableScrollWrapper = tableWrapper.createDiv({ cls: "github-link-table-scroll-wrapper" });
		const table = tableScrollWrapper.createEl("table", { cls: "github-link-table" });

		const queryType = this.params.queryType;

		// Use default columns if none are provided
		let columns = this.params.columns;
		if (!columns || columns.length === 0) {
			columns = DEFAULT_COLUMNS[queryType];
		}

		// Ensure columns are lowercase
		columns = columns.map((c) => c.toLowerCase());

		// Render
		this.renderFooter(this.params, this.resultMeta, tableWrapper);
		this.renderHeader(table, queryType, columns);
		this.renderBody(table, queryType, columns, this.result);
	}

	private renderHeader(table: HTMLTableElement, queryType: QueryType, columns: string[]): void {
		const thead = table.createEl("thead");
		for (const col of columns) {
			const th = thead.createEl("th", { cls: "github-link-table-sortable" });
			const headerText = ALL_COLUMNS[queryType][col]?.header ?? titleCase(col);

			const sortIdx = this.sortColumns.findIndex((s) => s.column === col);
			if (sortIdx !== -1) {
				const arrow = this.sortColumns[sortIdx].direction === "asc" ? "▲" : "▼";
				const position = this.sortColumns.length > 1 ? `${sortIdx + 1}` : "";
				th.setText(headerText);
				th.createSpan({
					cls: "github-link-table-sort-indicator",
					text: ` ${arrow}${position}`,
				});
			} else {
				th.setText(headerText);
			}

			th.addEventListener("click", (evt) => {
				this.handleHeaderClick(col, evt.shiftKey);
			});
		}
	}

	private handleHeaderClick(column: string, isShift: boolean): void {
		const existingIdx = this.sortColumns.findIndex((s) => s.column === column);

		if (isShift) {
			if (existingIdx === -1) {
				this.sortColumns.push({ column, direction: "asc" });
			} else if (this.sortColumns[existingIdx].direction === "asc") {
				this.sortColumns[existingIdx].direction = "desc";
			} else {
				this.sortColumns.splice(existingIdx, 1);
			}
		} else {
			if (existingIdx === -1) {
				this.sortColumns = [{ column, direction: "asc" }];
			} else if (this.sortColumns[existingIdx].direction === "asc") {
				this.sortColumns = [{ column, direction: "desc" }];
			} else {
				this.sortColumns = [];
			}
		}

		this.render();
	}

	private renderBody(table: HTMLTableElement, queryType: QueryType, columns: string[], result: TableResult): void {
		const tbody = table.createEl("tbody");
		for (const row of result) {
			const tr = tbody.createEl("tr");
			for (const col of columns) {
				this.renderCell(tr, queryType, col, row);
			}
		}
	}

	private renderCell(tr: HTMLTableRowElement, queryType: QueryType, column: string, row: TableResult[number]): void {
		const cell = tr.createEl("td");
		const renderer = ALL_COLUMNS[queryType][column];
		if (renderer) {
			void renderer.cell(row, cell);
		} else {
			const cellVal = getProp(row, column);
			if (cellVal !== null) {
				cell.setText(typeof cellVal === "string" ? cellVal : JSON.stringify(cellVal));
			} else {
				cell.setText("");
			}
		}
	}

	private renderFooter(params: QueryParams, meta: PaginationMeta | null, parent: HTMLElement): void {
		const footer = parent.createDiv({ cls: "github-link-table-footer" });

		if (this.result) {
			footer.createSpan({ cls: "github-link-table-row-count", text: `${this.result.length} rows` });
		}

		// Add external link to footer if available
		const externalLink = this.getExternalLink(params);
		if (externalLink && PluginSettings.showExternalLink) {
			footer.createEl("a", {
				cls: "github-link-table-footer-external-link",
				text: "View on GitHub",
				href: externalLink,
				attr: { target: "_blank" },
			});
		}

		this.renderPagination(meta, footer);

		if (PluginSettings.showRefresh) {
			const refreshButton = footer.createEl("button", {
				cls: "clickable-icon",
				attr: { "aria-label": "Refresh Results" },
			});
			refreshButton.addEventListener("click", () => {
				void this.setParams(this.params, true);
			});
			setIcon(refreshButton, "refresh-cw");
		}
	}

	private renderPagination(meta: PaginationMeta | null, parent: HTMLElement): void {
		if (PluginSettings.showPagination && this.hasSomeRel(meta)) {
			const pagination = parent.createDiv({ cls: "github-link-table-pagination" });

			// First, previous
			if (meta?.first && (!meta.prev || meta.prev.page !== meta.first.page)) {
				const first = pagination.createEl("a", { text: "<<", href: "#", attr: { role: "button" } });
				first.addEventListener("click", () => {
					void this.setParams({ ...this.params, page: meta.first?.page });
				});
			}
			if (meta?.prev) {
				const prev = pagination.createEl("a", { text: meta.prev.page.toString(), href: "#", attr: { role: "button" } });
				prev.addEventListener("click", () => {
					void this.setParams({ ...this.params, page: meta.prev?.page });
				});
			}

			// Current Page
			pagination.createSpan({ text: (this.params.page ?? 1).toString() });

			// Next, last
			if (meta?.next) {
				const next = pagination.createEl("a", { text: meta.next.page.toString(), href: "#", attr: { role: "button" } });
				next.addEventListener("click", () => {
					void this.setParams({ ...this.params, page: meta.next?.page });
				});
			}
			if (meta?.last && (!meta.next || meta.next.page !== meta.last.page)) {
				const last = pagination.createEl("a", { text: ">>", href: "#", attr: { role: "button" } });
				last.addEventListener("click", () => {
					void this.setParams({ ...this.params, page: meta.last?.page });
				});
			}
		}
	}

	private hasSomeRel(meta: PaginationMeta | null): boolean {
		return Boolean(meta && (meta.first || meta.prev || meta.next || meta.last));
	}

	private getExternalLink(params: QueryParams): string | null {
		// Custom search query
		if (params.query && (params.queryType === QueryType.Issue || params.queryType === QueryType.PullRequest)) {
			return `https://github.com/search?q=${encodeURIComponent(params.query)}`;
		} else {
			return null;
		}
	}
}
