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
				console.log("Tab updated:", tab);
				if ((window as any).multitabBrowser) {
					(window as any).multitabBrowser.handleTabUpdate(tab);
				}
			},
			tabClosed: ({ id }: { id: string }) => {
				console.log("Tab closed:", id);
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

interface TabInfo {
	id: string;
	title: string;
	url: string;
	canGoBack: boolean;
	canGoForward: boolean;
	isLoading: boolean;
	favicon?: string;
	isPinned?: boolean;
}

interface BookmarkInfo {
	id: string;
	title: string;
	url: string;
	createdAt: number;
}

class MultitabBrowser {
	private tabs: Map<string, TabInfo> = new Map();
	private tabOrder: string[] = [];
	private webviews: Map<string, WebviewTagElement> = new Map();
	private activeTabId: string | null = null;
	private bookmarks: Map<string, BookmarkInfo> = new Map();
	private dragState: { tabId: string; startX: number; element: HTMLElement } | null = null;

	constructor() {
		(window as any).multitabBrowser = this;
		this.initializeUI();
		this.loadBookmarks();
	}

	private initializeUI(): void {
		// New tab button
		document.getElementById("new-tab-btn")?.addEventListener("click", () => {
			this.createNewTab();
		});

		// URL bar navigation
		const urlBar = document.getElementById("url-bar") as HTMLInputElement;
		urlBar?.addEventListener("keypress", async (e) => {
			if (e.key === "Enter") {
				const url = urlBar.value.trim();
				if (url) {
					try {
						let processedUrl = url;
						if (!url.startsWith("http://") && !url.startsWith("https://")) {
							if (url.includes(".") && !url.includes(" ")) {
								processedUrl = `https://${url}`;
							} else {
								processedUrl = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
							}
						}

						if (!this.activeTabId) {
							await this.createNewTab(processedUrl);
							return;
						}

						const webview = this.webviews.get(this.activeTabId) as any;
						if (webview) {
							webview.src = processedUrl;
						}

						const tab = this.tabs.get(this.activeTabId);
						if (tab) {
							tab.url = processedUrl;
							this.handleTabUpdate(tab);
						}

						await (rpc as any).request.navigateTo({
							tabId: this.activeTabId,
							url: processedUrl,
						});
					} catch (error) {
						console.error("Failed to navigate:", error);
					}
				}
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
		const bookmarksMenuBtn = document.getElementById("bookmarks-menu-btn");
		bookmarksMenuBtn?.addEventListener("click", (e) => {
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

			if (mod && e.key.toLowerCase() === "d") {
				e.preventDefault();
				if (this.activeTabId) {
					this.duplicateTab(this.activeTabId);
				}
			}

			// Tab switching: Cmd/Ctrl + 1-9
			if (mod && e.key >= "1" && e.key <= "9") {
				e.preventDefault();
				const index = parseInt(e.key) - 1;
				if (index < this.tabOrder.length) {
					this.switchToTab(this.tabOrder[index]);
				}
			}

			// Next/previous tab: Cmd/Ctrl + Shift + ] / [
			if (mod && e.shiftKey && e.key === "]") {
				e.preventDefault();
				this.switchToNextTab();
			}
			if (mod && e.shiftKey && e.key === "[") {
				e.preventDefault();
				this.switchToPrevTab();
			}

			// Pin tab: Cmd/Ctrl + Shift + P
			if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
				e.preventDefault();
				if (this.activeTabId) {
					this.togglePinTab(this.activeTabId);
				}
			}
		});

		// Tab drag-and-drop on the tab bar
		const tabsContainer = document.getElementById("tabs-container");
		if (tabsContainer) {
			tabsContainer.addEventListener("mousedown", (e) => this.onTabDragStart(e));
			document.addEventListener("mousemove", (e) => this.onTabDragMove(e));
			document.addEventListener("mouseup", () => this.onTabDragEnd());
		}

		// Show welcome screen initially
		this.showWelcomeScreen();
	}

	// --- Tab drag-and-drop ---
	private onTabDragStart(e: MouseEvent): void {
		const tabEl = (e.target as HTMLElement).closest(".tab") as HTMLElement;
		if (!tabEl || (e.target as HTMLElement).classList.contains("tab-close")) return;
		const tabId = tabEl.dataset["tabId"];
		if (!tabId) return;

		// Don't allow dragging pinned tabs past unpinned and vice versa
		this.dragState = { tabId, startX: e.clientX, element: tabEl };
		tabEl.classList.add("dragging");
	}

	private onTabDragMove(e: MouseEvent): void {
		if (!this.dragState) return;
		const dx = e.clientX - this.dragState.startX;
		this.dragState.element.style.transform = `translateX(${dx}px)`;
		this.dragState.element.style.zIndex = "100";

		// Find the tab we're hovering over
		const tabs = Array.from(document.querySelectorAll(".tab:not(.dragging)"));
		for (const tab of tabs) {
			const rect = tab.getBoundingClientRect();
			const midX = rect.left + rect.width / 2;
			if (e.clientX > rect.left && e.clientX < rect.right) {
				const dragIdx = this.tabOrder.indexOf(this.dragState.tabId);
				const hoverId = (tab as HTMLElement).dataset["tabId"];
				if (!hoverId) continue;
				const hoverIdx = this.tabOrder.indexOf(hoverId);

				if (dragIdx !== -1 && hoverIdx !== -1 && dragIdx !== hoverIdx) {
					// Check pin boundary - don't mix pinned and unpinned
					const dragTab = this.tabs.get(this.dragState.tabId);
					const hoverTab = this.tabs.get(hoverId);
					if (dragTab?.isPinned !== hoverTab?.isPinned) continue;

					// Swap in order
					if (e.clientX < midX && dragIdx > hoverIdx) {
						this.tabOrder.splice(dragIdx, 1);
						this.tabOrder.splice(hoverIdx, 0, this.dragState.tabId);
						this.renderAllTabs();
						break;
					} else if (e.clientX >= midX && dragIdx < hoverIdx) {
						this.tabOrder.splice(dragIdx, 1);
						this.tabOrder.splice(hoverIdx, 0, this.dragState.tabId);
						this.renderAllTabs();
						break;
					}
				}
			}
		}
	}

	private onTabDragEnd(): void {
		if (!this.dragState) return;
		this.dragState.element.style.transform = "";
		this.dragState.element.style.zIndex = "";
		this.dragState.element.classList.remove("dragging");
		this.dragState = null;
	}

	// --- Tab order helpers ---
	private switchToNextTab(): void {
		if (!this.activeTabId || this.tabOrder.length < 2) return;
		const idx = this.tabOrder.indexOf(this.activeTabId);
		const nextIdx = (idx + 1) % this.tabOrder.length;
		this.switchToTab(this.tabOrder[nextIdx]);
	}

	private switchToPrevTab(): void {
		if (!this.activeTabId || this.tabOrder.length < 2) return;
		const idx = this.tabOrder.indexOf(this.activeTabId);
		const prevIdx = (idx - 1 + this.tabOrder.length) % this.tabOrder.length;
		this.switchToTab(this.tabOrder[prevIdx]);
	}

	private togglePinTab(tabId: string): void {
		const tab = this.tabs.get(tabId);
		if (!tab) return;
		tab.isPinned = !tab.isPinned;

		// Move pinned tabs to the front of the order
		const idx = this.tabOrder.indexOf(tabId);
		if (idx === -1) return;
		this.tabOrder.splice(idx, 1);

		if (tab.isPinned) {
			// Insert after last pinned tab
			let insertIdx = 0;
			for (let i = 0; i < this.tabOrder.length; i++) {
				if (this.tabs.get(this.tabOrder[i])?.isPinned) {
					insertIdx = i + 1;
				} else {
					break;
				}
			}
			this.tabOrder.splice(insertIdx, 0, tabId);
		} else {
			// Insert after last pinned tab
			let insertIdx = 0;
			for (let i = 0; i < this.tabOrder.length; i++) {
				if (this.tabs.get(this.tabOrder[i])?.isPinned) {
					insertIdx = i + 1;
				}
			}
			this.tabOrder.splice(insertIdx, 0, tabId);
		}

		this.renderAllTabs();
	}

	private async duplicateTab(tabId: string): Promise<void> {
		const tab = this.tabs.get(tabId);
		if (!tab) return;
		await this.createNewTab(tab.url);
	}

	private async createNewTab(url?: string): Promise<void> {
		try {
			const tab = await (rpc as any).request.createTab({ url });
			const tabInfo: TabInfo = {
				...tab,
				isPinned: false,
			};
			this.tabs.set(tab.id, tabInfo);
			this.tabOrder.push(tab.id);

			// Create electrobun-webview element
			const webview = document.createElement("electrobun-webview") as WebviewTagElement;
			webview.setAttribute("src", tab.url);
			webview.setAttribute("id", `webview-${tab.id}`);
			webview.setAttribute("masks", "#bookmarks-dropdown");
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
					this.handleTabUpdate(updatedTab);
				}
			});

			this.renderAllTabs();
			this.switchToTab(tab.id);
		} catch (error) {
			console.error("Failed to create tab:", error);
		}
	}

	private renderAllTabs(): void {
		const tabsContainer = document.getElementById("tabs-container");
		if (!tabsContainer) return;
		tabsContainer.innerHTML = "";

		for (const tabId of this.tabOrder) {
			const tab = this.tabs.get(tabId);
			if (!tab) continue;
			this.renderTab(tab, tabsContainer);
		}
	}

	private renderTab(tab: TabInfo, container?: HTMLElement): void {
		const tabsContainer = container || document.getElementById("tabs-container");
		if (!tabsContainer) return;

		const tabElement = document.createElement("div");
		tabElement.className = `tab${tab.isPinned ? " pinned" : ""}${tab.id === this.activeTabId ? " active" : ""}`;
		tabElement.id = `tab-${tab.id}`;
		tabElement.dataset["tabId"] = tab.id;

		const favicon = tab.favicon || "🌐";
		const titleHtml = tab.isPinned
			? `<span class="tab-favicon">${favicon}</span>`
			: `<span class="tab-favicon">${favicon}</span><span class="tab-title">${this.escapeHtml(this.truncateTitle(tab.title))}</span>`;

		const closeHtml = tab.isPinned
			? ""
			: `<button class="tab-close" data-tab-id="${tab.id}">×</button>`;

		tabElement.innerHTML = `${titleHtml}${closeHtml}`;

		tabElement.addEventListener("click", (e) => {
			if (!(e.target as HTMLElement).classList.contains("tab-close")) {
				this.switchToTab(tab.id);
			}
		});

		// Double-click to pin/unpin
		tabElement.addEventListener("dblclick", (e) => {
			if (!(e.target as HTMLElement).classList.contains("tab-close")) {
				this.togglePinTab(tab.id);
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
			const tab = this.tabs.get(tabId);
			if (tab?.isPinned) return; // Can't close pinned tabs

			await (rpc as any).request.closeTab({ id: tabId });
			this.tabs.delete(tabId);

			const webview = this.webviews.get(tabId);
			if (webview) {
				webview.remove();
				this.webviews.delete(tabId);
			}

			const orderIdx = this.tabOrder.indexOf(tabId);
			if (orderIdx !== -1) {
				this.tabOrder.splice(orderIdx, 1);
			}

			this.renderAllTabs();

			if (this.activeTabId === tabId) {
				this.activeTabId = null;
				if (this.tabOrder.length > 0) {
					// Switch to the tab at the same position or the last one
					const nextIdx = Math.min(orderIdx, this.tabOrder.length - 1);
					this.switchToTab(this.tabOrder[nextIdx]);
				} else {
					this.showWelcomeScreen();
				}
			} else if (this.tabOrder.length === 0) {
				this.activeTabId = null;
				this.showWelcomeScreen();
			}
		} catch (error) {
			console.error("Failed to close tab:", error);
		}
	}

	public handleTabUpdate(tab: TabInfo): void {
		const existing = this.tabs.get(tab.id);
		if (existing) {
			existing.title = tab.title;
			existing.url = tab.url;
			existing.isLoading = tab.isLoading;
			existing.canGoBack = tab.canGoBack;
			existing.canGoForward = tab.canGoForward;
			if (tab.favicon) existing.favicon = tab.favicon;
		} else {
			this.tabs.set(tab.id, { ...tab, isPinned: false });
		}

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
			this.updateBookmarkButton();
		}
	}

	public handleTabClosed(id: string): void {
		this.tabs.delete(id);
		const orderIdx = this.tabOrder.indexOf(id);
		if (orderIdx !== -1) this.tabOrder.splice(orderIdx, 1);
		document.getElementById(`tab-${id}`)?.remove();
	}

	private showWelcomeScreen(): void {
		const welcome = document.getElementById("welcome-screen");
		const webview = document.getElementById("webview-container");
		if (welcome) welcome.style.display = "flex";
		if (webview) webview.style.display = "none";
		const urlBar = document.getElementById("url-bar") as HTMLInputElement;
		if (urlBar) urlBar.value = "";
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
				bookmarksArray.forEach((bookmark: BookmarkInfo) => {
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
		const bookmarksArray = Array.from(this.bookmarks.values());
		localStorage.setItem("bookmarks", JSON.stringify(bookmarksArray));
	}

	private resetBookmarks(): void {
		this.bookmarks.clear();
		localStorage.removeItem("bookmarks");

		let counter = 0;
		const addDefault = (title: string, url: string) => {
			const bookmark: BookmarkInfo = {
				id: `bookmark-default-${counter++}`,
				title,
				url,
				createdAt: Date.now() + counter,
			};
			this.bookmarks.set(url, bookmark);
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
		const bookmark: BookmarkInfo = {
			id: `bookmark-${Date.now()}`,
			title,
			url,
			createdAt: Date.now(),
		};
		this.bookmarks.set(url, bookmark);
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
		if (dropdown) {
			dropdown.classList.toggle("hidden");
		}
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

		const bookmarksArray = Array.from(this.bookmarks.values());
		bookmarksArray.slice(0, 6).forEach((bookmark) => {
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
