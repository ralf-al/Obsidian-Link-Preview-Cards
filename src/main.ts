import { Editor, Plugin, requestUrl } from "obsidian";


export default class MyPlugin extends Plugin {


	async onload() {



		this.registerEvent(this.app.workspace.on("editor-paste", this.handleEditorPaste.bind(this)));
	}

	onunload() {
	}

	

	

	private async handleEditorPaste(clipboardEvent: ClipboardEvent, editor: Editor): Promise<void> {
		const clipboardText = clipboardEvent.clipboardData?.getData("text/plain")?.trim();
		if (!clipboardText) return;
		const pastedUrl = this.extractFirstUrl(clipboardText);
		if (!pastedUrl) return;

		const selectedText = editor.getSelection().trim();
		if (selectedText.length > 0) return;

		clipboardEvent.preventDefault();
		clipboardEvent.stopPropagation();
		const cardHtml = await this.buildRichLinkHtml(pastedUrl);
		editor.replaceSelection(`\n${cardHtml}\n`);
	}

	private extractFirstUrl(text: string): string | null {
		const urlPattern = /\bhttps?:\/\/[^\s<>)\]}]+/i;
		const match = text.match(urlPattern);
		return match?.[0] ?? null;
	}

	private async buildRichLinkHtml(url: string): Promise<string> {
		const metadata = await this.fetchMetadata(url);
		const safeUrl = this.escapeHtml(url);
		const safeTitle = this.escapeHtml(this.normalizeText(metadata.title || this.safeHostname(url)));
		const safeDescription = this.escapeHtml(this.normalizeText(metadata.description || ""));
		const safeSiteName = this.escapeHtml(this.normalizeText(metadata.siteName || this.safeHostname(url)));
		const safeAuthor = this.escapeHtml(this.normalizeText(metadata.author || ""));
		const safePageLabel = this.escapeHtml(this.normalizeText(this.getDisplayUrl(url)));
		const heroImageUrl = metadata.imageUrl || metadata.faviconUrl;
		const imageStyle = heroImageUrl
			? ` style="background-image: url('${this.escapeHtmlAttribute(heroImageUrl)}');"`
			: "";
		const emptyImageClass = heroImageUrl ? "" : " rlink-card__image--empty";
		const faviconImageClass = !metadata.imageUrl && metadata.faviconUrl ? " rlink-card__image--favicon" : "";
		const faviconStyle = metadata.faviconUrl
			? ` style="background-image: url('${this.escapeHtmlAttribute(metadata.faviconUrl)}');"`
			: "";
		const metaLabel = safeAuthor || safePageLabel;
		const metaPrefix = safeAuthor ? '<span class="rlink-card__meta-prefix">Author </span>' : "";
		const metaValueClass = safeAuthor ? "rlink-card__meta-value rlink-card__meta-value--author" : "rlink-card__meta-value";
		const authorAvatar = safeAuthor
			? metadata.authorImageUrl
				? `<span class="rlink-card__author-avatar" style="background-image: url('${this.escapeHtmlAttribute(metadata.authorImageUrl)}');"></span>`
				: metadata.faviconUrl
					? `<span class="rlink-card__author-avatar rlink-card__author-avatar--favicon"${faviconStyle}></span>`
					: ""
			: "";

		return `<div class="rlink-card-container"><div class="rlink-card-shell"><a class="rlink-card" href="${safeUrl}" target="_blank" rel="noopener noreferrer nofollow"><div class="rlink-card__image${emptyImageClass}${faviconImageClass}"${imageStyle}></div><div class="rlink-card__body"><div class="rlink-card__title">${safeTitle}</div><div class="rlink-card__description">${safeDescription}</div></div></a><a class="rlink-card__meta" href="${safeUrl}" target="_blank" rel="noopener noreferrer nofollow">${authorAvatar}${metaPrefix}<span class="${metaValueClass}">${metaLabel}</span></a></div></div>`;
	}

	private async fetchMetadata(url: string): Promise<{
		title: string;
		description: string;
		imageUrl: string;
		siteName: string;
		author: string;
		authorImageUrl: string;
		faviconUrl: string;
	}> {
		try {
			const response = await requestUrl({ url, method: "GET" });
			const html = response.text;

			return {
				title:
					this.readFirstMetaTag(html, [
						["property", "og:title"],
						["name", "twitter:title"],
					]) ?? this.readTitleTag(html) ?? "",
				description:
					this.readFirstMetaTag(html, [
						["property", "og:description"],
						["name", "description"],
						["name", "twitter:description"],
					]) ??
					"",
				imageUrl: this.resolveMaybeUrl(
					this.readFirstMetaTag(html, [
						["property", "og:image"],
						["name", "twitter:image"],
					]) ?? "",
					url,
				),
				siteName:
					this.readFirstMetaTag(html, [
						["property", "og:site_name"],
						["name", "application-name"],
					]) ?? "",
				author:
					this.readFirstMetaTag(html, [
						["name", "author"],
						["property", "author"],
						["property", "article:author"],
						["name", "twitter:creator"],
					]) ?? "",
				authorImageUrl: this.resolveMaybeUrl(
					this.readFirstMetaTag(html, [
						["name", "author:image"],
						["property", "author:image"],
						["property", "article:author:image"],
						["name", "parsely-author-image-url"],
						["name", "twitter:creator:image"],
						["property", "profile:image"],
					]) ?? "",
					url,
				),
				faviconUrl: this.readFaviconUrl(html, url),
			};
		} catch (error) {
			console.error("Failed to fetch metadata:", error);
			return {
				title: "",
				description: "",
				imageUrl: "",
				siteName: "",
				author: "",
				authorImageUrl: "",
				faviconUrl: this.buildDefaultFaviconUrl(url),
			};
		}
	}

	private readFirstMetaTag(
		html: string,
		selectors: Array<["property" | "name", string]>,
	): string | undefined {
		for (const [attribute, value] of selectors) {
			const result = this.readMetaTag(html, attribute, value);
			if (result) return result;
		}
		return undefined;
	}

	private readMetaTag(html: string, attribute: "property" | "name", value: string): string | undefined {
		const escapedValue = this.escapeRegExp(value);
		const pattern = new RegExp(
			`<meta[^>]*${attribute}=["']${escapedValue}["'][^>]*content=["']([^"']+)["'][^>]*>`,
			"i",
		);
		const reversePattern = new RegExp(
			`<meta[^>]*content=["']([^"']+)["'][^>]*${attribute}=["']${escapedValue}["'][^>]*>`,
			"i",
		);
		const match = html.match(pattern) ?? html.match(reversePattern);
		return match?.[1]?.trim();
	}

	private readTitleTag(html: string): string | undefined {
		const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
		return match?.[1]?.trim();
	}

	private readFaviconUrl(html: string, pageUrl: string): string {
		const rels = [
			"icon",
			"shortcut icon",
			"apple-touch-icon",
			"mask-icon",
		];
		for (const rel of rels) {
			const href = this.readLinkTagHref(html, rel);
			if (!href) continue;
			return this.resolveUrl(href, pageUrl);
		}
		return this.buildDefaultFaviconUrl(pageUrl);
	}

	private readLinkTagHref(html: string, relValue: string): string | undefined {
		const escapedRel = this.escapeRegExp(relValue);
		const pattern = new RegExp(
			`<link[^>]*rel=["']${escapedRel}["'][^>]*href=["']([^"']+)["'][^>]*>`,
			"i",
		);
		const reversePattern = new RegExp(
			`<link[^>]*href=["']([^"']+)["'][^>]*rel=["']${escapedRel}["'][^>]*>`,
			"i",
		);
		const match = html.match(pattern) ?? html.match(reversePattern);
		return match?.[1]?.trim();
	}

	private escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	private escapeHtml(value: string): string {
		return value
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	private escapeHtmlAttribute(value: string): string {
		return this.escapeHtml(value).replace(/`/g, "&#96;");
	}

	private normalizeText(value: string): string {
		const decoded = this.decodeHtmlEntities(value);
		return decoded.replace(/\s+/g, " ").trim();
	}

	private decodeHtmlEntities(value: string): string {
		const textarea = document.createElement("textarea");
		textarea.innerHTML = value;
		return textarea.value;
	}

	private safeHostname(url: string): string {
		try {
			return new URL(url).hostname;
		} catch (_error) {
			return url;
		}
	}

	private getDisplayUrl(url: string): string {
		const trimmed = url.trim();
		if (trimmed.endsWith("/") && trimmed.length > "https://x.x".length) return trimmed.slice(0, -1);
		return trimmed;
	}

	private buildDefaultFaviconUrl(pageUrl: string): string {
		try {
			const parsed = new URL(pageUrl);
			return `${parsed.origin}/favicon.ico`;
		} catch (_error) {
			return "";
		}
	}

	private resolveUrl(pathOrUrl: string, baseUrl: string): string {
		try {
			return new URL(pathOrUrl, baseUrl).toString();
		} catch (_error) {
			return pathOrUrl;
		}
	}

	private resolveMaybeUrl(pathOrUrl: string, baseUrl: string): string {
		if (!pathOrUrl) return "";
		return this.resolveUrl(pathOrUrl, baseUrl);
	}
}
