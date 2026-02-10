import Electrobun, {
	Electroview,
	type WebviewTagElement,
} from "electrobun/view";

console.log("Initializing Pioneer Browser UI...");

// Create RPC client
const rpc = Electroview.defineRPC<any>({
	maxRequestTime: 10000,
	handlers: {
		requests: {},
		messages: {
			tabUpdated: (tab: any) => {
				if ((window as any).multitabBrowser) {
					(window as any).multitabBrowser.handleTabUpdate(tab);
				}
			},
			tabClosed: ({ id }: { id: string }) => {
				if ((window as any).multitabBrowser) {
					(window as any).multitabBrowser.handleTabClosed(id);
				}
			},
		},
	},
});

// Initialize Electrobun with RPC
// @ts-expect-error - electrobun is used by webview tags for RPC
const electrobun = new Electrobun.Electroview({ rpc });

class MultitabBrowser {
	private tabs: Map<string, any> = new Map();
	private webviews: Map<string, WebviewTagElement> = new Map();
	private activeTabId: string | null = null;
	private bookmarks: Map<string, any> = new Map();
	private history: { title: string; url: string; timestamp: number }[] = [];
	private selectedSuggestionIndex = -1;
	private progressTimer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		(window as any).multitabBrowser = this;
		this.loadHistory();
		this.initializeUI();
		this.loadBookmarks();
	}

	private initializeUI(): void {
		// New tab button
		document.getElementById("new-tab-btn")?.addEventListener("click", () => {
			this.createNewTab();
		});

		// URL bar with autocomplete
		const urlBar = document.getElementById("url-bar") as HTMLInputElement;

		urlBar?.addEventListener("input", () => {
			this.showSuggestions(urlBar.value.trim());
		});

		urlBar?.addEventListener("focus", () => {
			urlBar.select();
			if (urlBar.value.trim()) {
				this.showSuggestions(urlBar.value.trim());
			}
		});

		urlBar?.addEventListener("blur", () => {
			// Delay to allow click on suggestions
			setTimeout(() => {
				this.hideSuggestions();
			}, 200);
		});

		urlBar?.addEventListener("keydown", (e) => {
			const suggestions = document.getElementById("url-suggestions");
			const items = suggestions?.querySelectorAll(".url-suggestion-item");

			if (e.key === "ArrowDown") {
				e.preventDefault();
				if (items && items.length > 0) {
					this.selectedSuggestionIndex = Math.min(
						this.selectedSuggestionIndex + 1,
						items.length - 1,
					);
					this.updateSuggestionSelection(items);
				}
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				if (items && items.length > 0) {
					this.selectedSuggestionIndex = Math.max(
						this.selectedSuggestionIndex - 1,
						-1,
					);
					this.updateSuggestionSelection(items);
				}
			} else if (e.key === "Enter") {
				e.preventDefault();
				if (
					this.selectedSuggestionIndex >= 0 &&
					items &&
					items[this.selectedSuggestionIndex]
				) {
					const item = items[this.selectedSuggestionIndex] as HTMLElement;
					const url = item.dataset["url"];
					if (url) {
						urlBar.value = url;
						this.hideSuggestions();
						this.navigateUrl(url);
						return;
					}
				}
				const url = urlBar.value.trim();
				if (url) {
					this.hideSuggestions();
					this.navigateUrl(url);
				}
			} else if (e.key === "Escape") {
				this.hideSuggestions();
				urlBar.blur();
			}
		});

		// Navigation buttons
		document.getElementById("back-btn")?.addEventListener("click", async () => {
			if (this.activeTabId) {
				const webview = this.webviews.get(this.activeTabId) as any;
				if (webview && webview.goBack) {
					webview.goBack();
				}
			}
		});

		document.getElementById("forward-btn")?.addEventListener("click", async () => {
			if (this.activeTabId) {
				const webview = this.webviews.get(this.activeTabId) as any;
				if (webview && webview.goForward) {
					webview.goForward();
				}
			}
		});

		document.getElementById("reload-btn")?.addEventListener("click", async () => {
			if (this.activeTabId) {
				const webview = this.webviews.get(this.activeTabId) as any;
				if (webview && webview.reload) {
					webview.reload();
				}
			}
		});

		document.getElementById("home-btn")?.addEventListener("click", async () => {
			const homeUrl = "https://electrobun.dev";
			if (this.activeTabId) {
				const webview = this.webviews.get(this.activeTabId) as any;
				if (webview) {
					webview.src = homeUrl;
					const tab = this.tabs.get(this.activeTabId);
					if (tab) {
						tab.url = homeUrl;
						this.handleTabUpdate(tab);
					}
				}
			} else {
				await this.createNewTab(homeUrl);
			}
		});

		// Bookmark button
		document.getElementById("bookmark-btn")?.addEventListener("click", () => {
			this.toggleBookmark();
		});

		// Bookmarks menu button
		document.getElementById("bookmarks-menu-btn")?.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleBookmarksMenu();
		});

		// Reset bookmarks button
		document.addEventListener("click", (e) => {
			if ((e.target as HTMLElement)?.id === "reset-bookmarks-btn") {
				e.preventDefault();
				e.stopPropagation();
				this.resetBookmarks();
			}
		});

		// Close bookmarks dropdown when clicking outside
		document.addEventListener("click", (e) => {
			const dropdown = document.getElementById("bookmarks-dropdown");
			const menuBtn = document.getElementById("bookmarks-menu-btn");
			const resetBtn = document.getElementById("reset-bookmarks-btn");
			if (
				dropdown &&
				!dropdown.contains(e.target as Node) &&
				e.target !== menuBtn &&
				e.target !== resetBtn
			) {
				dropdown.classList.add("hidden");
			}
		});

		// Keyboard shortcuts
		document.addEventListener("keydown", (e) => {
			const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
			const mod = isMac ? e.metaKey : e.ctrlKey;

			if (mod && e.key.toLowerCase() === "t") {
				e.preventDefault();
				this.createNewTab();
			}

			if (mod && e.key.toLowerCase() === "w") {
				e.preventDefault();
				if (this.activeTabId) {
					this.closeTab(this.activeTabId);
				}
			}

			if (mod && e.key.toLowerCase() === "l") {
				e.preventDefault();
				const urlBar = document.getElementById("url-bar") as HTMLInputElement;
				urlBar?.focus();
				urlBar?.select();
			}

			if (mod && e.key.toLowerCase() === "r") {
				e.preventDefault();
				if (this.activeTabId) {
					const webview = this.webviews.get(this.activeTabId) as any;
					if (webview && webview.reload) {
						webview.reload();
					}
				}
			}
		});

		this.showWelcomeScreen();
	}

	// --- URL processing ---
	private processUrl(url: string): string {
		if (url.startsWith("http://") || url.startsWith("https://")) {
			return url;
		}

		// Check if it looks like a domain name
		const domainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+/;
		if (domainPattern.test(url) && !url.includes(" ")) {
			return `https://${url}`;
		}

		// Check for localhost
		if (url.startsWith("localhost") || url.match(/^127\.\d+\.\d+\.\d+/)) {
			return `http://${url}`;
		}

		// Treat as search query
		return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
	}

	private async navigateUrl(input: string): Promise<void> {
		const url = this.processUrl(input);

		if (!this.activeTabId) {
			await this.createNewTab(url);
			return;
		}

		const webview = this.webviews.get(this.activeTabId) as any;
		if (webview) {
			webview.src = url;
		}

		const tab = this.tabs.get(this.activeTabId);
		if (tab) {
			tab.url = url;
			tab.isLoading = true;
			this.handleTabUpdate(tab);
		}

		this.showProgress();

		try {
			await (rpc as any).request.navigateTo({
				tabId: this.activeTabId,
				url,
			});
		} catch (error) {
			console.error("Failed to navigate:", error);
		}

		// Add to history
		this.addToHistory(tab?.title || url, url);
	}

	// --- Security indicator ---
	private updateSecurityIndicator(url: string): void {
		const icon = document.getElementById("url-security-icon");
		if (!icon) return;

		icon.className = "url-security-icon";
		if (url.startsWith("https://")) {
			icon.classList.add("secure");
			icon.title = "Secure connection (HTTPS)";
		} else if (url.startsWith("http://")) {
			icon.classList.add("insecure");
			icon.title = "Not secure (HTTP)";
		} else {
			icon.title = "Enter a URL or search";
		}
	}

	// --- Progress bar ---
	private showProgress(): void {
		const progress = document.getElementById("nav-progress");
		const bar = document.getElementById("nav-progress-bar");
		if (!progress || !bar) return;

		progress.classList.remove("hidden");
		bar.classList.add("indeterminate");
		bar.style.width = "";

		if (this.progressTimer) {
			clearTimeout(this.progressTimer);
		}

		// Auto-hide after 10s as fallback
		this.progressTimer = setTimeout(() => {
			this.hideProgress();
		}, 10000);
	}

	private hideProgress(): void {
		const progress = document.getElementById("nav-progress");
		const bar = document.getElementById("nav-progress-bar");
		if (!progress || !bar) return;

		bar.classList.remove("indeterminate");
		bar.style.width = "100%";
		setTimeout(() => {
			progress.classList.add("hidden");
			bar.style.width = "0%";
		}, 300);

		if (this.progressTimer) {
			clearTimeout(this.progressTimer);
			this.progressTimer = null;
		}
	}

	// --- URL Suggestions ---
	private showSuggestions(query: string): void {
		if (!query) {
			this.hideSuggestions();
			return;
		}

		const suggestions = this.getSuggestions(query);
		const container = document.getElementById("url-suggestions");
		if (!container) return;

		if (suggestions.length === 0) {
			this.hideSuggestions();
			return;
		}

		container.innerHTML = "";
		this.selectedSuggestionIndex = -1;

		suggestions.forEach((suggestion) => {
			const item = document.createElement("div");
			item.className = "url-suggestion-item";
			item.dataset["url"] = suggestion.url;

			const icon = suggestion.type === "bookmark" ? "⭐" : suggestion.type === "history" ? "🕐" : "🔍";

			item.innerHTML = `
				<span class="suggestion-icon">${icon}</span>
				<span class="suggestion-text">${this.escapeHtml(suggestion.title)}</span>
				<span class="suggestion-url">${this.escapeHtml(suggestion.url)}</span>
			`;

			item.addEventListener("mousedown", (e) => {
				e.preventDefault();
				const urlBar = document.getElementById("url-bar") as HTMLInputElement;
				if (urlBar) {
					urlBar.value = suggestion.url;
				}
				this.hideSuggestions();
				this.navigateUrl(suggestion.url);
			});

			container.appendChild(item);
		});

		container.classList.remove("hidden");
	}

	private hideSuggestions(): void {
		const container = document.getElementById("url-suggestions");
		if (container) {
			container.classList.add("hidden");
		}
		this.selectedSuggestionIndex = -1;
	}

	private updateSuggestionSelection(items: NodeListOf<Element>): void {
		items.forEach((item, index) => {
			if (index === this.selectedSuggestionIndex) {
				item.classList.add("selected");
				const urlBar = document.getElementById("url-bar") as HTMLInputElement;
				if (urlBar) {
					urlBar.value = (item as HTMLElement).dataset["url"] || "";
				}
			} else {
				item.classList.remove("selected");
			}
		});
	}

	private getSuggestions(query: string): { title: string; url: string; type: string }[] {
		const lowerQuery = query.toLowerCase();
		const results: { title: string; url: string; type: string; score: number }[] = [];

		// Search bookmarks
		this.bookmarks.forEach((bookmark) => {
			const titleMatch = bookmark.title.toLowerCase().includes(lowerQuery);
			const urlMatch = bookmark.url.toLowerCase().includes(lowerQuery);
			if (titleMatch || urlMatch) {
				results.push({
					title: bookmark.title,
					url: bookmark.url,
					type: "bookmark",
					score: titleMatch ? 2 : 1,
				});
			}
		});

		// Search history
		this.history.forEach((entry) => {
			const titleMatch = entry.title.toLowerCase().includes(lowerQuery);
			const urlMatch = entry.url.toLowerCase().includes(lowerQuery);
			if (titleMatch || urlMatch) {
				// Don't duplicate bookmarks
				if (!results.some((r) => r.url === entry.url)) {
					results.push({
						title: entry.title,
						url: entry.url,
						type: "history",
						score: titleMatch ? 1.5 : 0.5,
					});
				}
			}
		});

		// Sort by score descending
		results.sort((a, b) => b.score - a.score);
		return results.slice(0, 8);
	}

	// --- History ---
	private loadHistory(): void {
		try {
			const stored = localStorage.getItem("browsingHistory");
			if (stored) {
				this.history = JSON.parse(stored);
			}
		} catch (error) {
			console.error("Failed to load history:", error);
		}
	}

	private addToHistory(title: string, url: string): void {
		// Don't add search URLs or duplicates of the last entry
		if (this.history.length > 0 && this.history[0].url === url) return;

		this.history.unshift({
			title,
			url,
			timestamp: Date.now(),
		});

		// Keep last 1000 entries
		if (this.history.length > 1000) {
			this.history = this.history.slice(0, 1000);
		}

		localStorage.setItem("browsingHistory", JSON.stringify(this.history));
	}

	// --- Tab management ---
	private async createNewTab(url?: string): Promise<void> {
		try {
			const tab = await (rpc as any).request.createTab({ url });
			this.tabs.set(tab.id, tab);

			const webview = document.createElement("electrobun-webview") as WebviewTagElement;
			webview.setAttribute("src", tab.url);
			webview.setAttribute("id", `webview-${tab.id}`);
			webview.setAttribute("masks", "#bookmarks-dropdown,#url-suggestions");
			webview.setAttribute("renderer", "cef");
			webview.classList.add("tab-webview");

			const container = document.getElementById("webview-container");
			if (container) {
				container.appendChild(webview);
			}

			this.webviews.set(tab.id, webview);

			webview.addEventListener("page-title-updated", (e: any) => {
				const updatedTab = this.tabs.get(tab.id);
				if (updatedTab) {
					updatedTab.title = e.detail?.title || "New Tab";
					this.handleTabUpdate(updatedTab);
				}
			});

			webview.addEventListener("did-navigate", (e: any) => {
				const updatedTab = this.tabs.get(tab.id);
				if (updatedTab && e.detail?.url) {
					updatedTab.url = e.detail.url;
					updatedTab.isLoading = false;
					this.handleTabUpdate(updatedTab);
					this.hideProgress();
					this.addToHistory(updatedTab.title, updatedTab.url);
				}
			});

			this.renderTab(tab);
			this.switchToTab(tab.id);
		} catch (error) {
			console.error("Failed to create tab:", error);
		}
	}

	private renderTab(tab: any): void {
		const tabsContainer = document.getElementById("tabs-container");
		if (!tabsContainer) return;

		const tabElement = document.createElement("div");
		tabElement.className = "tab";
		tabElement.id = `tab-${tab.id}`;
		tabElement.innerHTML = `
			<span class="tab-title">${this.escapeHtml(this.truncateTitle(tab.title))}</span>
			<button class="tab-close" data-tab-id="${tab.id}">×</button>
		`;

		tabElement.addEventListener("click", (e) => {
			if (!(e.target as HTMLElement).classList.contains("tab-close")) {
				this.switchToTab(tab.id);
			}
		});

		tabElement.querySelector(".tab-close")?.addEventListener("click", (e) => {
			e.stopPropagation();
			this.closeTab(tab.id);
		});

		tabsContainer.appendChild(tabElement);
	}

	private async switchToTab(tabId: string): Promise<void> {
		try {
			document.querySelectorAll(".tab").forEach((tab) => {
				tab.classList.remove("active");
			});
			document.getElementById(`tab-${tabId}`)?.classList.add("active");

			this.webviews.forEach((webview) => {
				webview.toggleHidden(true);
				webview.togglePassthrough(true);
			});

			const selectedWebview = this.webviews.get(tabId);
			if (selectedWebview) {
				selectedWebview.classList.add("active");
				selectedWebview.toggleHidden(false);
				selectedWebview.togglePassthrough(false);
			}

			this.activeTabId = tabId;
			const tab = this.tabs.get(tabId);

			if (tab) {
				const urlBar = document.getElementById("url-bar") as HTMLInputElement;
				if (urlBar) {
					urlBar.value = tab.url;
				}
				this.updateSecurityIndicator(tab.url);
				this.updateBookmarkButton();
				this.hideWelcomeScreen();
			}

			await (rpc as any).request.activateTab({ tabId });
		} catch (error) {
			console.error("Failed to switch tab:", error);
		}
	}

	private async closeTab(tabId: string): Promise<void> {
		try {
			await (rpc as any).request.closeTab({ id: tabId });
			this.tabs.delete(tabId);

			const webview = this.webviews.get(tabId);
			if (webview) {
				webview.remove();
				this.webviews.delete(tabId);
			}

			document.getElementById(`tab-${tabId}`)?.remove();

			const remainingTabs = Array.from(this.tabs.keys());

			if (this.activeTabId === tabId) {
				this.activeTabId = null;
				if (remainingTabs.length > 0) {
					this.switchToTab(remainingTabs[remainingTabs.length - 1]);
				} else {
					this.showWelcomeScreen();
				}
			} else if (remainingTabs.length === 0) {
				this.activeTabId = null;
				this.showWelcomeScreen();
			}
		} catch (error) {
			console.error("Failed to close tab:", error);
		}
	}

	public handleTabUpdate(tab: any): void {
		this.tabs.set(tab.id, tab);

		const tabElement = document.getElementById(`tab-${tab.id}`);
		if (tabElement) {
			const titleElement = tabElement.querySelector(".tab-title");
			if (titleElement) {
				titleElement.textContent = this.truncateTitle(tab.title);
			}
		}

		if (this.activeTabId === tab.id) {
			const urlBar = document.getElementById("url-bar") as HTMLInputElement;
			if (urlBar && document.activeElement !== urlBar) {
				urlBar.value = tab.url;
			}
			this.updateSecurityIndicator(tab.url);
			this.updateBookmarkButton();

			if (!tab.isLoading) {
				this.hideProgress();
			}
		}
	}

	public handleTabClosed(id: string): void {
		this.tabs.delete(id);
		document.getElementById(`tab-${id}`)?.remove();
	}

	private showWelcomeScreen(): void {
		const welcome = document.getElementById("welcome-screen");
		const webview = document.getElementById("webview-container");
		if (welcome) welcome.style.display = "flex";
		if (webview) webview.style.display = "none";
		const urlBar = document.getElementById("url-bar") as HTMLInputElement;
		if (urlBar) urlBar.value = "";
		this.updateSecurityIndicator("");
	}

	private hideWelcomeScreen(): void {
		const welcome = document.getElementById("welcome-screen");
		const webview = document.getElementById("webview-container");
		if (welcome) welcome.style.display = "none";
		if (webview) webview.style.display = "block";
	}

	private truncateTitle(title: string, maxLength: number = 20): string {
		if (title.length <= maxLength) return title;
		return title.substring(0, maxLength - 3) + "...";
	}

	private escapeHtml(text: string): string {
		const div = document.createElement("div");
		div.textContent = text;
		return div.innerHTML;
	}

	// --- Bookmarks ---
	private async loadBookmarks(): Promise<void> {
		try {
			const stored = localStorage.getItem("bookmarks");
			if (stored) {
				const bookmarksArray = JSON.parse(stored);
				bookmarksArray.forEach((bookmark: any) => {
					this.bookmarks.set(bookmark.url, bookmark);
				});
			} else {
				this.addBookmark("Electrobun", "https://electrobun.dev");
				this.addBookmark("Electrobun GitHub", "https://github.com/blackboardsh/electrobun");
				this.addBookmark("Yoav on Bluesky", "https://bsky.app/profile/yoav.codes");
				this.addBookmark("Blackboard", "https://www.blackboard.sh");
			}
			this.renderBookmarks();
			this.renderQuickLinks();
		} catch (error) {
			console.error("Failed to load bookmarks:", error);
		}
	}

	private saveBookmarks(): void {
		localStorage.setItem("bookmarks", JSON.stringify(Array.from(this.bookmarks.values())));
	}

	private resetBookmarks(): void {
		this.bookmarks.clear();
		localStorage.removeItem("bookmarks");
		let counter = 0;
		const addDefault = (title: string, url: string) => {
			this.bookmarks.set(url, {
				id: `bookmark-default-${counter++}`,
				title,
				url,
				createdAt: Date.now() + counter,
			});
		};
		addDefault("Electrobun", "https://electrobun.dev");
		addDefault("Electrobun GitHub", "https://github.com/blackboardsh/electrobun");
		addDefault("Yoav on Bluesky", "https://bsky.app/profile/yoav.codes");
		addDefault("Blackboard", "https://www.blackboard.sh");
		this.saveBookmarks();
		this.renderBookmarks();
		this.renderQuickLinks();
		this.updateBookmarkButton();
	}

	private addBookmark(title: string, url: string): void {
		this.bookmarks.set(url, {
			id: `bookmark-${Date.now()}`,
			title,
			url,
			createdAt: Date.now(),
		});
		this.saveBookmarks();
	}

	private removeBookmark(url: string): void {
		this.bookmarks.delete(url);
		this.saveBookmarks();
	}

	private toggleBookmark(): void {
		if (!this.activeTabId) return;
		const tab = this.tabs.get(this.activeTabId);
		if (!tab) return;
		const bookmarkBtn = document.getElementById("bookmark-btn");
		if (!bookmarkBtn) return;

		if (this.bookmarks.has(tab.url)) {
			this.removeBookmark(tab.url);
			bookmarkBtn.classList.remove("bookmarked");
		} else {
			this.addBookmark(tab.title || "Untitled", tab.url);
			bookmarkBtn.classList.add("bookmarked");
		}
		this.renderBookmarks();
		this.renderQuickLinks();
	}

	private updateBookmarkButton(): void {
		const bookmarkBtn = document.getElementById("bookmark-btn");
		if (!bookmarkBtn || !this.activeTabId) return;
		const tab = this.tabs.get(this.activeTabId);
		if (tab && this.bookmarks.has(tab.url)) {
			bookmarkBtn.classList.add("bookmarked");
		} else {
			bookmarkBtn.classList.remove("bookmarked");
		}
	}

	private toggleBookmarksMenu(): void {
		const dropdown = document.getElementById("bookmarks-dropdown");
		if (dropdown) dropdown.classList.toggle("hidden");
	}

	private renderBookmarks(): void {
		const bookmarksList = document.getElementById("bookmarks-list");
		if (!bookmarksList) return;
		bookmarksList.innerHTML = "";

		if (this.bookmarks.size === 0) {
			bookmarksList.innerHTML = '<div class="no-bookmarks">No bookmarks yet</div>';
			return;
		}

		this.bookmarks.forEach((bookmark) => {
			const item = document.createElement("div");
			item.className = "bookmark-item";
			item.innerHTML = `
				<div class="bookmark-info">
					<div class="bookmark-title">${this.escapeHtml(bookmark.title)}</div>
					<div class="bookmark-url">${this.escapeHtml(this.truncateUrl(bookmark.url))}</div>
				</div>
				<button class="bookmark-delete" data-url="${this.escapeHtml(bookmark.url)}">×</button>
			`;

			item.querySelector(".bookmark-info")?.addEventListener("click", async () => {
				if (this.activeTabId) {
					const webview = this.webviews.get(this.activeTabId) as any;
					if (webview) {
						webview.src = bookmark.url;
						const tab = this.tabs.get(this.activeTabId);
						if (tab) {
							tab.url = bookmark.url;
							this.handleTabUpdate(tab);
						}
					}
				} else {
					await this.createNewTab(bookmark.url);
				}
				document.getElementById("bookmarks-dropdown")?.classList.add("hidden");
			});

			item.querySelector(".bookmark-delete")?.addEventListener("click", (e) => {
				e.stopPropagation();
				const url = (e.currentTarget as HTMLElement).dataset["url"];
				if (url) {
					this.removeBookmark(url);
					this.renderBookmarks();
					this.renderQuickLinks();
					this.updateBookmarkButton();
				}
			});

			bookmarksList.appendChild(item);
		});
	}

	private renderQuickLinks(): void {
		const container = document.getElementById("quick-links-container");
		if (!container) return;
		container.innerHTML = "";

		Array.from(this.bookmarks.values())
			.slice(0, 6)
			.forEach((bookmark) => {
				const link = document.createElement("button");
				link.className = "quick-link";
				link.innerHTML = `
					<div class="quick-link-favicon">🌐</div>
					<div class="quick-link-title">${this.escapeHtml(this.truncateTitle(bookmark.title, 15))}</div>
				`;
				link.addEventListener("click", () => {
					this.createNewTab(bookmark.url);
				});
				container.appendChild(link);
			});
	}

	private truncateUrl(url: string, maxLength: number = 40): string {
		if (url.length <= maxLength) return url;
		return url.substring(0, maxLength - 3) + "...";
	}
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => {
		new MultitabBrowser();
	});
} else {
	new MultitabBrowser();
}
