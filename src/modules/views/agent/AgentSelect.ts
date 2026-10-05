import { button, documentOf, element } from "./dom";
import { icon } from "./icons";

export type AgentSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

let nextSelectId = 0;

/** HTML listbox for Zotero chrome windows, where native select popups fail. */
export class AgentSelect {
  readonly element: HTMLDivElement;
  readonly trigger: HTMLButtonElement;
  onChange?: (value: string) => void;
  private label: HTMLElement;
  private menu: HTMLDivElement;
  private options: AgentSelectOption[] = [];
  private selectedValue = "";
  private activeIndex = -1;
  private dismiss?: () => void;
  private search = "";
  private searchAt = 0;

  constructor(
    doc: Document,
    private name: string,
    options: AgentSelectOption[] = [],
    className = "",
  ) {
    this.element = element(doc, "div", `agent-picker ${className}`.trim());
    this.trigger = button(doc, "", () => this.toggle(), "agent-picker-trigger");
    this.trigger.setAttribute("role", "combobox");
    this.trigger.setAttribute("aria-label", name);
    this.trigger.setAttribute("aria-haspopup", "listbox");
    this.trigger.setAttribute("aria-expanded", "false");
    this.label = element(doc, "span", "agent-picker-label");
    this.trigger.append(this.label, icon(doc, "chevron"));
    this.menu = element(doc, "div", "agent-select-menu");
    this.menu.id = `agent-select-${++nextSelectId}`;
    this.menu.hidden = true;
    this.menu.setAttribute("role", "listbox");
    this.menu.setAttribute("aria-label", name);
    this.trigger.setAttribute("aria-controls", this.menu.id);
    this.element.append(this.trigger, this.menu);
    this.trigger.addEventListener("keydown", (event: KeyboardEvent) =>
      this.onKeyDown(event),
    );
    this.menu.addEventListener("mousedown", (event) => event.preventDefault());
    this.setOptions(options);
  }

  get value(): string {
    return this.selectedValue;
  }

  set value(value: string) {
    this.close();
    this.selectedValue = this.options.some((option) => option.value === value)
      ? value
      : this.options[0]?.value || "";
    this.updateSelection();
  }

  get disabled(): boolean {
    return this.trigger.disabled;
  }

  set disabled(disabled: boolean) {
    this.trigger.disabled = disabled;
    if (disabled) this.close();
  }

  setOptions(options: AgentSelectOption[], value = this.value): void {
    this.close();
    this.options = [...options];
    this.menu.replaceChildren();
    const doc = documentOf(this.element);
    options.forEach((option, index) => {
      const row = element(doc, "div", "agent-select-option", option.label);
      row.id = `${this.menu.id}-${index}`;
      row.setAttribute("role", "option");
      row.setAttribute("data-value", option.value);
      row.setAttribute("aria-disabled", String(!!option.disabled));
      row.addEventListener("mousemove", () => this.highlight(index));
      row.addEventListener("click", (event) => {
        event.stopPropagation();
        this.choose(index);
      });
      this.menu.append(row);
    });
    this.value = value;
  }

  /** Close and detach listeners from the adopted document, including on hide. */
  close(): void {
    this.menu.hidden = true;
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.removeAttribute("aria-activedescendant");
    this.dismiss?.();
    this.dismiss = undefined;
  }

  private updateSelection(): void {
    const selected = this.options.find((option) => option.value === this.value);
    this.label.textContent = selected?.label || this.name;
    this.trigger.title = `${this.name}: ${this.label.textContent}`;
    this.trigger.setAttribute("data-value", this.value);
    Array.from(this.menu.children).forEach((row, index) => {
      row.setAttribute(
        "aria-selected",
        String(this.options[index].value === this.value),
      );
    });
  }

  private toggle(): void {
    if (this.menu.hidden) this.open();
    else this.close();
  }

  private open(): void {
    if (this.disabled || !this.options.some((option) => !option.disabled))
      return;
    // Controls are created in Zotero's main document, then adopted by the dialog.
    // Capture its current owner only when opening, never the construction document.
    const doc = documentOf(this.element);
    const win = doc.defaultView;
    if (!win) return;
    this.close();
    this.menu.hidden = false;
    this.trigger.setAttribute("aria-expanded", "true");
    this.search = "";
    const anchor = this.trigger.getBoundingClientRect();
    const width = Math.min(win.innerWidth - 24, Math.max(anchor.width, 260));
    const below = win.innerHeight - anchor.bottom - 18;
    const above = anchor.top - 18;
    const upward = above > below;
    const maxHeight = Math.max(40, Math.min(300, upward ? above : below));
    Object.assign(this.menu.style, {
      width: `${width}px`,
      maxHeight: `${maxHeight}px`,
      left: `${Math.max(12, Math.min(anchor.left, win.innerWidth - width - 12))}px`,
    });
    const height = this.menu.getBoundingClientRect().height;
    this.menu.style.top = `${Math.max(12, upward ? anchor.top - height - 6 : anchor.bottom + 6)}px`;
    const selected = this.options.findIndex(
      (option) => option.value === this.value && !option.disabled,
    );
    this.highlight(
      selected < 0
        ? this.options.findIndex((option) => !option.disabled)
        : selected,
    );

    const outside = (event: Event) => {
      if (event.target && !this.element.contains(event.target as Node))
        this.close();
    };
    const resize = () => this.close();
    const scroll = (event: Event) => {
      if (event.target !== this.menu) this.close();
    };
    doc.addEventListener("mousedown", outside, true);
    doc.addEventListener("focusin", outside, true);
    doc.addEventListener("scroll", scroll, true);
    win.addEventListener("resize", resize);
    this.dismiss = () => {
      doc.removeEventListener("mousedown", outside, true);
      doc.removeEventListener("focusin", outside, true);
      doc.removeEventListener("scroll", scroll, true);
      win.removeEventListener("resize", resize);
    };
  }

  private highlight(index: number): void {
    if (index < 0 || this.options[index]?.disabled) return;
    this.activeIndex = index;
    Array.from(this.menu.children).forEach((row, i) =>
      row.classList.toggle("is-highlighted", i === index),
    );
    const row = this.menu.children[index] as HTMLElement;
    this.trigger.setAttribute("aria-activedescendant", row.id);
    if (row.offsetTop < this.menu.scrollTop)
      this.menu.scrollTop = row.offsetTop;
    else if (
      row.offsetTop + row.offsetHeight >
      this.menu.scrollTop + this.menu.clientHeight
    )
      this.menu.scrollTop =
        row.offsetTop + row.offsetHeight - this.menu.clientHeight;
  }

  private choose(index: number): void {
    const option = this.options[index];
    if (!option || option.disabled || this.disabled) return;
    const changed = this.value !== option.value;
    this.value = option.value;
    this.trigger.focus();
    if (changed) this.onChange?.(this.value);
  }

  private move(direction: number): void {
    let next = this.activeIndex;
    for (let i = 0; i < this.options.length; i++) {
      next = (next + direction + this.options.length) % this.options.length;
      if (!this.options[next].disabled) {
        this.highlight(next);
        return;
      }
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.disabled) return;
    const wasOpen = !this.menu.hidden;
    if (event.key === "Tab") {
      this.close();
      return;
    }
    if (event.key === "Escape") {
      if (wasOpen) {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
      return;
    }
    if (
      ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (!wasOpen) this.open();
      else if (event.key === "Enter" || event.key === " ")
        this.choose(this.activeIndex);
      if (event.key === "ArrowDown" && wasOpen) this.move(1);
      if (event.key === "ArrowUp" && wasOpen) this.move(-1);
      if (event.key === "Home") {
        this.activeIndex = -1;
        this.move(1);
      } else if (event.key === "End") {
        this.activeIndex = 0;
        this.move(-1);
      }
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      if (!wasOpen) this.open();
      const now = Date.now();
      this.search =
        (now - this.searchAt < 700 ? this.search : "") +
        event.key.toLocaleLowerCase();
      this.searchAt = now;
      const index = this.options.findIndex(
        (option) =>
          !option.disabled &&
          option.label.toLocaleLowerCase().startsWith(this.search),
      );
      this.highlight(index);
    }
  }
}
