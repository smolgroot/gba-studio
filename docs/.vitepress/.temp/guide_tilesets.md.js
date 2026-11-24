import { ssrRenderAttrs, ssrRenderAttr } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const _imports_0 = "/screenshots/tileset.png";
const _imports_1 = "/screenshots/new-tileset.png";
const __pageData = JSON.parse('{"title":"Tilesets","description":"","frontmatter":{},"headers":[],"relativePath":"guide/tilesets.md","filePath":"guide/tilesets.md","lastUpdated":1795475281000}');
const _sfc_main = { name: "guide/tilesets.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="tilesets" tabindex="-1">Tilesets <a class="header-anchor" href="#tilesets" aria-label="Permalink to &quot;Tilesets&quot;">​</a></h1><p>A tileset is a PNG whose size is a multiple of 8, cut into 8x8 tiles, with a collision class painted on each tile.</p><p><img${ssrRenderAttr("src", _imports_0)} alt="The Badlands tileset with collision classes painted on the tiles"></p><h2 id="create-one" tabindex="-1">Create one <a class="header-anchor" href="#create-one" aria-label="Permalink to &quot;Create one&quot;">​</a></h2><p>Press <strong>+</strong> beside Tilesets, name it, and choose a PNG already in the folder or <strong>Import an image</strong>.</p><p><img${ssrRenderAttr("src", _imports_1)} alt="The New tileset dialog"></p><p>To make one from scratch, use the <a href="./tools#platformer-tileset-generator">Platformer tileset generator</a> in Tools.</p><h2 id="paint-collision" tabindex="-1">Paint collision <a class="header-anchor" href="#paint-collision" aria-label="Permalink to &quot;Paint collision&quot;">​</a></h2><ol><li>Open the tileset.</li><li>Choose a class in <strong>Paint collision</strong> (Solid, One-way platform, slopes, Hazard and so on).</li><li>Click or drag across tiles to give them that class. Tiles are outlined in the class colour.</li></ol><p>The top bar shows the image size, the tile count and the number of distinct GBA colours (colours are reduced to 5 bits a channel, as the hardware does). At its right end, a readout such as &quot;480/1024 tiles · 7/16 palettes&quot; shows the background tiles and palettes the image needs, counted as the build counts them; hover it to see what is counted. It turns amber from 90% of a limit and red past it. If the build could not convert the image (a tile with 16 colours, or a 17th palette needed), the readout says &quot;not convertible&quot; and gives the reason. Properties shows the name, image and number of tiles with a class. <strong>Edit pixels</strong> opens the image in the <a href="./pixel-editor">pixel editor</a>.</p><h2 id="limits" tabindex="-1">Limits <a class="header-anchor" href="#limits" aria-label="Permalink to &quot;Limits&quot;">​</a></h2><ul><li>At most 1024 tiles, and 15 colours per tile.</li><li>A tileset can use up to 16 palettes, one per tile.</li></ul><p>The GBA&#39;s video memory holds 1024 background tiles and 16 background palettes of 15 colours and transparent. A tileset over a limit, or one that cannot be converted, is listed in Problems on the tileset, with the build helper&#39;s wording, as soon as the image is saved. Rooms add their backgrounds&#39; tiles and palettes to the tileset&#39;s; see <a href="./rooms#tile-and-palette-budget">Rooms</a>. Collision classes themselves are defined in <code>studio/project.json</code> (<a href="./../reference/project-format">format</a>); they are not editable in the interface yet.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("guide/tilesets.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const tilesets = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  tilesets as default
};
