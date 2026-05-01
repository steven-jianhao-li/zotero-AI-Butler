export type MainTabDescriptor<T extends string> = {
  id: T;
  label: string;
  icon: string;
};

export type SettingsNavDescriptor<T extends string> = {
  id: T;
  label: string;
};

export type MainWindowScaffoldRefs<T extends string> = {
  topNav: HTMLElement;
  viewPort: HTMLElement;
  setActiveTab: (tabId: T) => void;
  setMainNavVisible: (visible: boolean) => void;
};

export type SettingsScaffoldRefs<T extends string> = {
  settingsSidebar: HTMLElement;
  settingsContent: HTMLElement;
  setActiveCategory: (categoryId: T) => void;
  scrollSettingsTop: () => void;
};

function getDocument(host: HTMLElement): Document {
  const doc = host.ownerDocument;
  if (!doc) {
    throw new Error("Host element has no ownerDocument");
  }
  return doc;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  options: {
    id?: string;
    className?: string;
    textContent?: string;
    styles?: Partial<CSSStyleDeclaration>;
  } = {},
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);

  if (options.id) {
    element.id = options.id;
  }
  if (options.className) {
    element.className = options.className;
  }
  if (typeof options.textContent === "string") {
    element.textContent = options.textContent;
  }
  if (options.styles) {
    Object.assign(element.style, options.styles);
  }

  return element;
}

function applyHostFrame(host: HTMLElement): void {
  Object.assign(host.style, {
    width: "100%",
    height: "100%",
    minHeight: "0",
    margin: "0",
    padding: "0",
    overflow: "hidden",
    position: "relative",
    boxSizing: "border-box",
    backgroundColor: "var(--ai-bg)",
    fontFamily: "system-ui, -apple-system, sans-serif",
  } as Partial<CSSStyleDeclaration>);
}

export function createMainWindowScaffold<T extends string>(
  host: HTMLElement,
  tabs: Array<MainTabDescriptor<T>>,
  onTabClick: (tabId: T) => void,
): MainWindowScaffoldRefs<T> {
  const doc = getDocument(host);
  applyHostFrame(host);
  host.innerHTML = "";

  const root = createElement(doc, "div", {
    id: "ai-butler-window-scaffold",
    styles: {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      minHeight: "0",
      display: "grid",
      gridTemplateRows: "auto minmax(0, 1fr)",
      overflow: "hidden",
      backgroundColor: "var(--ai-bg)",
      boxSizing: "border-box",
      color: "var(--ai-text)",
      fontFamily: "system-ui, -apple-system, sans-serif",
    },
  });

  const topNav = createElement(doc, "div", {
    id: "tab-bar",
    styles: {
      display: "flex",
      minHeight: "0",
      backgroundColor: "var(--ai-surface)",
      borderBottom: "2px solid var(--ai-border)",
      boxShadow: "0 1px 0 rgba(0, 0, 0, 0.04)",
      zIndex: "20",
    },
  });

  const viewPort = createElement(doc, "div", {
    id: "view-container",
    styles: {
      position: "relative",
      minHeight: "0",
      minWidth: "0",
      overflow: "hidden",
      backgroundColor: "var(--ai-surface)",
    },
  });

  const tabButtons = new Map<T, HTMLElement>();
  for (const tab of tabs) {
    const button = createElement(doc, "button", {
      id: `tab-${tab.id}`,
      className: "tab-button",
      styles: {
        flex: "1",
        minWidth: "0",
        padding: "12px 20px",
        border: "none",
        borderBottom: "3px solid transparent",
        backgroundColor: "transparent",
        color: "var(--ai-text-muted)",
        fontSize: "14px",
        fontWeight: "600",
        cursor: "pointer",
        transition: "all 0.2s",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        boxSizing: "border-box",
        whiteSpace: "nowrap",
      },
    });
    button.innerHTML = `${tab.icon} ${tab.label}`;
    button.addEventListener("click", () => onTabClick(tab.id));
    button.addEventListener("mouseenter", () => {
      if (!button.classList.contains("active")) {
        button.style.backgroundColor = "var(--ai-accent-tint)";
      }
    });
    button.addEventListener("mouseleave", () => {
      if (!button.classList.contains("active")) {
        button.style.backgroundColor = "transparent";
      }
    });
    tabButtons.set(tab.id, button);
    topNav.appendChild(button);
  }

  root.append(topNav, viewPort);
  host.appendChild(root);

  return {
    topNav,
    viewPort,
    setActiveTab(tabId) {
      tabButtons.forEach((button, id) => {
        const active = id === tabId;
        button.classList.toggle("active", active);
        button.style.color = active
          ? "var(--ai-accent)"
          : "var(--ai-text-muted)";
        button.style.backgroundColor = active
          ? "var(--ai-accent-tint)"
          : "transparent";
        button.style.borderBottomColor = active
          ? "var(--ai-accent)"
          : "transparent";
      });
    },
    setMainNavVisible(visible) {
      topNav.style.display = visible ? "flex" : "none";
      root.style.gridTemplateRows = visible
        ? "auto minmax(0, 1fr)"
        : "minmax(0, 1fr)";
    },
  };
}

export function createSettingsScaffold<T extends string>(
  host: HTMLElement,
  categories: Array<SettingsNavDescriptor<T>>,
  onCategoryClick: (categoryId: T) => void,
): SettingsScaffoldRefs<T> {
  const doc = getDocument(host);
  applyHostFrame(host);
  host.innerHTML = "";

  const root = createElement(doc, "div", {
    id: "ai-butler-settings-scaffold",
    styles: {
      position: "absolute",
      inset: "0",
      display: "grid",
      gridTemplateColumns: "220px minmax(0, 1fr)",
      minHeight: "0",
      minWidth: "0",
      overflow: "hidden",
      backgroundColor: "var(--ai-bg)",
      boxSizing: "border-box",
    },
  });

  const settingsSidebar = createElement(doc, "div", {
    id: "settings-sidebar",
    styles: {
      minHeight: "0",
      minWidth: "0",
      overflow: "hidden",
      padding: "18px 0",
      borderRight: "1px solid var(--ai-border)",
      backgroundColor: "var(--ai-surface-2)",
      boxShadow: "1px 0 0 rgba(0, 0, 0, 0.02)",
      boxSizing: "border-box",
      zIndex: "5",
    },
  });

  const settingsContent = createElement(doc, "div", {
    id: "settings-content",
    styles: {
      minHeight: "0",
      minWidth: "0",
      overflowY: "auto",
      overflowX: "hidden",
      padding: "24px 28px 36px",
      backgroundColor: "var(--ai-surface)",
      boxSizing: "border-box",
      overscrollBehavior: "contain",
      scrollbarGutter: "stable",
    },
  });

  const navButtons = new Map<T, HTMLElement>();
  for (const category of categories) {
    const button = createElement(doc, "button", {
      className: "settings-nav-button",
      textContent: category.label,
      styles: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        width: "100%",
        minHeight: "38px",
        padding: "9px 18px 9px 20px",
        border: "none",
        borderLeft: "3px solid transparent",
        backgroundColor: "transparent",
        color: "var(--ai-text-muted)",
        cursor: "pointer",
        fontSize: "14px",
        fontWeight: "normal",
        textAlign: "left",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
        transition: "all 0.2s",
      },
    });
    button.addEventListener("click", () => onCategoryClick(category.id));
    button.addEventListener("mouseenter", () => {
      if (!button.classList.contains("active")) {
        button.style.backgroundColor = "var(--ai-accent-tint)";
      }
    });
    button.addEventListener("mouseleave", () => {
      if (!button.classList.contains("active")) {
        button.style.backgroundColor = "transparent";
      }
    });
    navButtons.set(category.id, button);
    settingsSidebar.appendChild(button);
  }

  settingsSidebar.addEventListener(
    "wheel",
    (event: WheelEvent) => {
      if (
        !event.deltaY ||
        !canScrollInDirection(settingsContent, event.deltaY)
      ) {
        return;
      }
      settingsContent.scrollTop += event.deltaY;
      event.preventDefault();
    },
    { passive: false },
  );

  root.append(settingsSidebar, settingsContent);
  host.appendChild(root);

  return {
    settingsSidebar,
    settingsContent,
    setActiveCategory(categoryId) {
      navButtons.forEach((button, id) => {
        const active = id === categoryId;
        button.classList.toggle("active", active);
        button.style.backgroundColor = active
          ? "var(--ai-accent-tint)"
          : "transparent";
        button.style.color = active
          ? "var(--ai-accent)"
          : "var(--ai-text-muted)";
        button.style.borderLeftColor = active
          ? "var(--ai-accent)"
          : "transparent";
        button.style.fontWeight = active ? "600" : "normal";
      });
    },
    scrollSettingsTop() {
      settingsContent.scrollTop = 0;
    },
  };
}

function canScrollInDirection(element: HTMLElement, deltaY: number): boolean {
  if (deltaY > 0) {
    return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
  }
  return element.scrollTop > 0;
}
