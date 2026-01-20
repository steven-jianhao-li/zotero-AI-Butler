import * as d3 from "d3";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";

// 将库挂载到 window 对象上，供 HTML 页面使用
window.d3 = d3;
window.markmap = {
  Transformer,
  Markmap,
};

console.log("[markmap-bundle] 已加载");
