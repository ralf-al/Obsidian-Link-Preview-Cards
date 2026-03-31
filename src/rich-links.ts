import { MarkdownPostProcessorContext, requestUrl } from "obsidian";

export interface RichLinkMetadata {
	url: string;
	title: string;
	description: string;
	imageUrl: string;
	siteName: string;
}

export interface RichLinkStore {
	[url: string]: RichLinkMetadata;
}

const RICH_LINK_PATTERN = /!rlink\[(https?:\/\/[^\]\s]+)\]/gi;

export function findRichLinkMatches(text: string): Array<{ fullMatch: string; url: string }> {
	const matches: Array<{ fullMatch: string; url: string }> = [];
	for (const match of text.matchAll(RICH_LINK_PATTERN)) {
		const fullMatch = match[0];
		const url = match[1];
		if (!fullMatch || !url) continue;
		matches.push({ fullMatch, url });
	}
	return matches;
}

export async function renderRichLinksInElement(
	root: HTMLElement,
	context: MarkdownPostProcessorContext,
	cache: RichLinkStore,
	onCacheUpdate: () => Promise<void>,
): Promise<void> {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const textNodes: Text[] = [];

	let currentNode = walker.nextNode();
	while (currentNode) {
		if (currentNode instanceof Text && (currentNode.nodeValue ?? "").includes("!rlink[")) {
			textNodes.push(currentNode);
		}
		currentNode = walker.nextNode();
	}

	for (const textNode of textNodes) {
		await replaceRichLinkTextNode(textNode, cache, onCacheUpdate);
	}
	void context;
}

async function replaceRichLinkTextNode(
	textNode: Text,
	cache: RichLinkStore,
	onCacheUpdate: () => Promise<void>,
): Promise<void> {
	const sourceText = textNode.nodeValue ?? "";
	const matches = findRichLinkMatches(sourceText);
	if (matches.length === 0) return;

	const fragment = document.createDocumentFragment();
	const stack = createStackElement();

	let remaining = sourceText;
	for (const match of matches) {
		const splitIndex = remaining.indexOf(match.fullMatch);
		if (splitIndex < 0) continue;

		const beforeText = remaining.slice(0, splitIndex);
		if (beforeText.length > 0) fragment.appendChild(document.createTextNode(beforeText));

		const card = await createRichLinkCard(match.url, cache, onCacheUpdate);
		stack.appendChild(card);

		remaining = remaining.slice(splitIndex + match.fullMatch.length);
	}

	fragment.appendChild(stack);
	if (remaining.length > 0) fragment.appendChild(document.createTextNode(remaining));

	textNode.replaceWith(fragment);
}

function createStackElement(): HTMLElement {
	const stack = document.createElement("div");
	stack.addClass("rlink-stack");
	return stack;
}

async function createRichLinkCard(
	url: string,
	cache: RichLinkStore,
	onCacheUpdate: () => Promise<void>,
): Promise<HTMLElement> {
	const metadata = await getRichLinkMetadata(url, cache, onCacheUpdate);
	const hostname = safeHostname(url);

	const card = createCardElement(url);
	const image = card.createDiv({ cls: "rlink-card__image" });
	if (metadata.imageUrl) image.style.backgroundImage = `url("${metadata.imageUrl}")`;
	else image.classList.add("rlink-card__image--empty");

	const body = card.createDiv({ cls: "rlink-card__body" });

	body.createDiv({
		cls: "rlink-card__title",
		text: metadata.title || hostname,
	});
	body.createDiv({
		cls: "rlink-card__description",
		text: metadata.description || "Open link",
	});
	body.createDiv({
		cls: "rlink-card__footer",
		text: metadata.siteName || hostname,
	});

	return card;
}

function createCardElement(url: string): HTMLAnchorElement {
	const card = document.createElement("a");
	card.addClass("rlink-card");
	card.href = url;
	card.target = "_blank";
	card.rel = "noopener noreferrer nofollow";
	return card;
}

async function getRichLinkMetadata(
	url: string,
	cache: RichLinkStore,
	onCacheUpdate: () => Promise<void>,
): Promise<RichLinkMetadata> {
	const cached = cache[url];
	if (cached) return cached;

	const fallback: RichLinkMetadata = {
		url,
		title: safeHostname(url),
		description: "",
		imageUrl: "",
		siteName: safeHostname(url),
	};

	try {
		const response = await requestUrl({ url, method: "GET" });
		const html = response.text;
		const metadata: RichLinkMetadata = {
			url,
			title: readMetaTag(html, "property", "og:title") ?? readTitleTag(html) ?? fallback.title,
			description:
				readMetaTag(html, "property", "og:description") ??
				readMetaTag(html, "name", "description") ??
				"",
			imageUrl:
				readMetaTag(html, "property", "og:image") ??
				readMetaTag(html, "name", "twitter:image") ??
				"",
			siteName: readMetaTag(html, "property", "og:site_name") ?? fallback.siteName,
		};

		cache[url] = metadata;
		await onCacheUpdate();
		return metadata;
	} catch (error) {
		console.error("Could not fetch rich link metadata:", error);
		cache[url] = fallback;
		await onCacheUpdate();
		return fallback;
	}
}

function readMetaTag(
	html: string,
	attribute: "property" | "name",
	value: string,
): string | undefined {
	const escapedValue = escapeRegExp(value);
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

function readTitleTag(html: string): string | undefined {
	const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
	return match?.[1]?.trim();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeHostname(url: string): string {
	try {
		return new URL(url).hostname;
	} catch (_error) {
		return url;
	}
}
