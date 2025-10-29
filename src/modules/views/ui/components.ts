/**
 * 通用 UI 组件工具
 *
 * @file components.ts
 * @author AI Butler Team
 */

/**
 * 按钮尺寸配置
 */
export type ButtonSize = "small" | "medium" | "large";

/**
 * 创建带悬停效果的按钮
 *
 * @param text 按钮文本（可包含 HTML，如 emoji）
 * @param color 按钮颜色
 * @param size 按钮尺寸：small(8px 16px)/medium(10px 20px)/large(15px)
 * @returns 按钮元素
 */
export function createStyledButton(
  text: string,
  color: string,
  size: ButtonSize = "medium",
): HTMLButtonElement {
  const doc = Zotero.getMainWindow().document;
  const button = doc.createElement("button");

  // 尺寸映射
  const sizeMap = {
    small: { padding: "8px 16px", fontSize: "12px" },
    medium: { padding: "10px 20px", fontSize: "14px" },
    large: { padding: "15px", fontSize: "14px" },
  };
  const sizeStyle = sizeMap[size];

  // 初始样式
  const baseStyle = {
    padding: sizeStyle.padding,
    border: `2px solid ${color}`,
    borderRadius: "6px",
    fontSize: sizeStyle.fontSize,
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.2s ease",
    outline: "none",
    // 文字垂直居中
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
  };

  // 设置初始状态 - 白色背景，文字显示颜色
  Object.assign(button.style, {
    ...baseStyle,
    backgroundColor: "#ffffff",
    color: color,
  });

  // 支持 HTML（如 emoji + 文本）
  button.innerHTML = text;

  // 悬停效果：背景变色，文字变白
  button.addEventListener("mouseenter", () => {
    button.style.backgroundColor = color;
    button.style.transform = "translateY(-1px)";
    button.style.boxShadow = `0 2px 8px ${color}40`;
  });

  button.addEventListener("mouseleave", () => {
    button.style.backgroundColor = "#ffffff";
    button.style.color = color;
    button.style.transform = "translateY(0)";
    button.style.boxShadow = "none";
  });

  // 点击效果
  button.addEventListener("mousedown", () => {
    button.style.transform = "translateY(0)";
  });

  button.addEventListener("mouseup", () => {
    button.style.transform = "translateY(-1px)";
  });

  return button;
}

/**
 * 创建表单组
 *
 * @param label 标签文本
 * @param input 输入元素
 * @param description 描述文本
 * @returns 表单组元素
 */
export function createFormGroup(
  label: string,
  input: HTMLElement,
  description?: string,
): HTMLElement {
  const doc = Zotero.getMainWindow().document;
  const group = doc.createElement("div");

  Object.assign(group.style, {
    marginBottom: "24px",
  });

  const labelElement = doc.createElement("label");
  labelElement.textContent = label;
  Object.assign(labelElement.style, {
    display: "block",
    marginBottom: "8px",
    fontSize: "14px",
    fontWeight: "600",
    color: "#333",
  });
  group.appendChild(labelElement);

  group.appendChild(input);

  if (description) {
    const desc = doc.createElement("div");
    desc.textContent = description;
    Object.assign(desc.style, {
      marginTop: "6px",
      fontSize: "12px",
      color: "#666",
      lineHeight: "1.4",
    });
    group.appendChild(desc);
  }

  return group;
}

/**
 * 创建输入框
 */
export function createInput(
  id: string,
  type: string,
  value: string,
  placeholder?: string,
): HTMLInputElement {
  const doc = Zotero.getMainWindow().document;
  const input = doc.createElement("input");
  input.type = type;
  input.id = `setting-${id}`;
  input.value = value || "";
  if (placeholder) input.placeholder = placeholder;

  Object.assign(input.style, {
    width: "100%",
    padding: "10px 12px",
    fontSize: "14px",
    border: "1px solid #ddd",
    borderRadius: "4px",
    boxSizing: "border-box",
    transition: "border-color 0.2s",
  });

  input.addEventListener("focus", () => {
    input.style.borderColor = "#59c0bc";
    input.style.outline = "none";
    input.style.boxShadow = "0 0 0 3px rgba(89, 192, 188, 0.1)";
  });

  input.addEventListener("blur", () => {
    input.style.borderColor = "#ddd";
    input.style.boxShadow = "none";
  });

  return input;
}

/**
 * 创建多行文本框
 */
export function createTextarea(
  id: string,
  value: string,
  rows: number = 12,
  placeholder?: string,
): HTMLTextAreaElement {
  const doc = Zotero.getMainWindow().document;
  const textarea = doc.createElement("textarea");
  textarea.id = `setting-${id}`;
  textarea.value = value || "";
  textarea.rows = rows;
  if (placeholder) textarea.placeholder = placeholder;

  Object.assign(textarea.style, {
    width: "100%",
    padding: "10px 12px",
    fontSize: "14px",
    border: "1px solid #ddd",
    borderRadius: "4px",
    boxSizing: "border-box",
    fontFamily: "Consolas, Menlo, monospace",
    lineHeight: "1.5",
    resize: "vertical",
  });

  textarea.addEventListener("focus", () => {
    textarea.style.borderColor = "#59c0bc";
    textarea.style.outline = "none";
    textarea.style.boxShadow = "0 0 0 3px rgba(89, 192, 188, 0.1)";
  });

  textarea.addEventListener("blur", () => {
    textarea.style.borderColor = "#ddd";
    textarea.style.boxShadow = "none";
  });

  return textarea;
}

/**
 * 创建自定义下拉选择框 (适配 Zotero 环境)
 *
 * 由于原生 <select> 在 Zotero XUL 中有兼容问题，
 * 这里使用纯 HTML/CSS/JS 实现一个自定义下拉框
 */
export function createSelect(
  id: string,
  options: Array<{ value: string; label: string }>,
  value: string,
  onChange?: (newValue: string) => void,
): HTMLElement {
  const doc = Zotero.getMainWindow().document;

  // 容器
  const container = doc.createElement("div");
  container.id = `setting-${id}`;
  container.setAttribute("data-value", value);
  Object.assign(container.style, {
    position: "relative",
    width: "100%",
    userSelect: "none",
  });

  // 当前选中项显示框
  const display = doc.createElement("div");
  const currentOption =
    options.find((opt) => opt.value === value) || options[0];
  display.textContent = currentOption ? currentOption.label : "";
  display.className = "custom-select-display";
  Object.assign(display.style, {
    width: "100%",
    padding: "10px 30px 10px 12px",
    fontSize: "14px",
    border: "1px solid #ddd",
    borderRadius: "4px",
    backgroundColor: "#fff",
    cursor: "pointer",
    boxSizing: "border-box",
    position: "relative",
    transition: "border-color 0.2s",
  });

  // 下拉箭头
  const arrow = doc.createElement("span");
  arrow.textContent = "▼";
  Object.assign(arrow.style, {
    position: "absolute",
    right: "10px",
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: "10px",
    color: "#666",
    pointerEvents: "none",
  });
  display.appendChild(arrow);

  // 下拉选项容器
  const dropdown = doc.createElement("div");
  dropdown.className = "custom-select-dropdown";
  Object.assign(dropdown.style, {
    position: "absolute",
    top: "100%",
    left: "0",
    right: "0",
    marginTop: "4px",
    backgroundColor: "#fff",
    border: "1px solid #ddd",
    borderRadius: "4px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    maxHeight: "240px",
    overflowY: "auto",
    zIndex: "1000",
    display: "none",
  });

  // 创建选项
  options.forEach((opt) => {
    const item = doc.createElement("div");
    item.textContent = opt.label;
    item.setAttribute("data-value", opt.value);
    Object.assign(item.style, {
      padding: "10px 12px",
      cursor: "pointer",
      fontSize: "14px",
      transition: "background-color 0.15s",
      backgroundColor: opt.value === value ? "#e3f2fd" : "#fff",
    });

    // 悬停效果
    item.addEventListener("mouseenter", () => {
      if (
        item.getAttribute("data-value") !== container.getAttribute("data-value")
      ) {
        item.style.backgroundColor = "#f5f5f5";
      }
    });
    item.addEventListener("mouseleave", () => {
      if (
        item.getAttribute("data-value") !== container.getAttribute("data-value")
      ) {
        item.style.backgroundColor = "#fff";
      }
    });

    // 点击选择
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const newValue = item.getAttribute("data-value")!;

      // 更新容器的当前值
      container.setAttribute("data-value", newValue);

      // 更新显示文本
      display.childNodes[0].textContent = opt.label;

      // 更新所有选项的背景色
      dropdown.querySelectorAll("div").forEach((el: Element) => {
        const elValue = el.getAttribute("data-value");
        (el as HTMLElement).style.backgroundColor =
          elValue === newValue ? "#e3f2fd" : "#fff";
      });

      // 关闭下拉框
      dropdown.style.display = "none";
      arrow.textContent = "▼";

      // 触发回调
      if (onChange) {
        onChange(newValue);
      }

      // 触发 change 事件（用于兼容原有代码）
      const event = new CustomEvent("change", { detail: { value: newValue } });
      container.dispatchEvent(event);
    });

    dropdown.appendChild(item);
  });

  // 点击显示框切换下拉框
  display.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display === "block";

    if (isOpen) {
      dropdown.style.display = "none";
      arrow.textContent = "▼";
    } else {
      dropdown.style.display = "block";
      arrow.textContent = "▲";
    }
  });

  // 点击外部关闭下拉框
  doc.addEventListener(
    "click",
    () => {
      dropdown.style.display = "none";
      arrow.textContent = "▼";
    },
    { capture: true },
  );

  // 聚焦样式
  display.addEventListener("mouseenter", () => {
    display.style.borderColor = "#59c0bc";
  });
  display.addEventListener("mouseleave", () => {
    if (dropdown.style.display !== "block") {
      display.style.borderColor = "#ddd";
    }
  });

  container.appendChild(display);
  container.appendChild(dropdown);

  // 添加辅助方法到容器
  (container as any).getValue = () => container.getAttribute("data-value");
  (container as any).setValue = (newValue: string) => {
    const opt = options.find((o) => o.value === newValue);
    if (opt) {
      container.setAttribute("data-value", newValue);
      display.childNodes[0].textContent = opt.label;
      dropdown.querySelectorAll("div").forEach((el: Element) => {
        const elValue = el.getAttribute("data-value");
        (el as HTMLElement).style.backgroundColor =
          elValue === newValue ? "#e3f2fd" : "#fff";
      });
    }
  };

  return container;
}

/**
 * 创建复选框
 */
export function createCheckbox(id: string, checked: boolean): HTMLElement {
  const doc = Zotero.getMainWindow().document;
  const container = doc.createElement("div");
  Object.assign(container.style, {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  });

  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = `setting-${id}`;
  checkbox.checked = checked;

  Object.assign(checkbox.style, {
    width: "20px",
    height: "20px",
    cursor: "pointer",
  });

  const label = doc.createElement("span");
  label.textContent = checked ? "已启用" : "已禁用";
  Object.assign(label.style, {
    fontSize: "14px",
    color: "#666",
  });

  checkbox.addEventListener("change", () => {
    label.textContent = checkbox.checked ? "已启用" : "已禁用";
  });

  container.appendChild(checkbox);
  container.appendChild(label);

  return container;
}

/**
 * 创建滑块 + 数值显示
 */
export function createSlider(
  id: string,
  min: number,
  max: number,
  step: number,
  value: number,
): HTMLElement {
  const doc = Zotero.getMainWindow().document;
  const container = doc.createElement("div");
  Object.assign(container.style, {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  });

  const slider = doc.createElement("input");
  slider.type = "range";
  slider.id = `setting-${id}`;
  slider.min = min.toString();
  slider.max = max.toString();
  slider.step = step.toString();
  slider.value = value.toString();

  Object.assign(slider.style, {
    flex: "1",
    height: "6px",
    borderRadius: "3px",
    outline: "none",
  });

  const valueDisplay = doc.createElement("span");
  valueDisplay.textContent = value.toFixed(2);
  Object.assign(valueDisplay.style, {
    minWidth: "50px",
    textAlign: "right",
    fontSize: "14px",
    fontWeight: "600",
    color: "#59c0bc",
  });

  slider.addEventListener("input", () => {
    valueDisplay.textContent = parseFloat(slider.value).toFixed(2);
  });

  container.appendChild(slider);
  container.appendChild(valueDisplay);
  return container;
}

/** 创建分节标题 */
export function createSectionTitle(text: string): HTMLElement {
  const el = Zotero.getMainWindow().document.createElement("h3");
  el.textContent = text;
  Object.assign(el.style, {
    marginTop: "12px",
    marginBottom: "12px",
    color: "#333",
  });
  return el;
}

/** 信息条 */
export function createNotice(
  html: string,
  type: "info" | "warn" | "error" = "info",
): HTMLElement {
  const el = Zotero.getMainWindow().document.createElement("div");
  const palette = {
    info: { bg: "#e3f2fd", bd: "#2196f3", fg: "#1565c0" },
    warn: { bg: "#fff8e1", bd: "#ff9800", fg: "#ef6c00" },
    error: { bg: "#ffebee", bd: "#f44336", fg: "#c62828" },
  } as const;
  const p = palette[type];
  Object.assign(el.style, {
    padding: "12px 16px",
    backgroundColor: p.bg,
    border: `1px solid ${p.bd}`,
    borderRadius: "6px",
    marginBottom: "16px",
    fontSize: "14px",
    color: p.fg,
  });
  el.innerHTML = html;
  return el;
}
