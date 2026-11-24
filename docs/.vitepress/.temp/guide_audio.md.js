import { ssrRenderAttrs, ssrRenderAttr } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const _imports_0 = "/screenshots/audio.png";
const __pageData = JSON.parse('{"title":"Audio","description":"","frontmatter":{},"headers":[],"relativePath":"guide/audio.md","filePath":"guide/audio.md","lastUpdated":1795039845000}');
const _sfc_main = { name: "guide/audio.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="audio" tabindex="-1">Audio <a class="header-anchor" href="#audio" aria-label="Permalink to &quot;Audio&quot;">​</a></h1><p>Open <strong>Audio</strong> in the Project panel.</p><p><img${ssrRenderAttr("src", _imports_0)} alt="The Audio page listing five tracker music tracks"></p><h2 id="import" tabindex="-1">Import <a class="header-anchor" href="#import" aria-label="Permalink to &quot;Import&quot;">​</a></h2><p>Press <strong>Import music or sounds</strong>. Files go to <code>assets/audio/</code>.</p><table tabindex="0"><thead><tr><th>Format</th><th>Becomes</th></tr></thead><tbody><tr><td><strong>XM</strong>, <strong>MOD</strong> (tracker music)</td><td>A music track</td></tr><tr><td><strong>MIDI</strong> with an <strong>SF2</strong> soundfont</td><td>A music track (agb needs a soundfont to turn notes into sound)</td></tr><tr><td><strong>WAV</strong></td><td>A sound effect</td></tr></tbody></table><h2 id="manage" tabindex="-1">Manage <a class="header-anchor" href="#manage" aria-label="Permalink to &quot;Manage&quot;">​</a></h2><ul><li>Name tracks and effects.</li><li>Remove them from the project with the bin; <strong>the file stays on disk</strong>.</li><li>For a MIDI track, pick which soundfont it uses. XM and MOD show &quot;instruments in the file&quot;.</li><li>Give a room a music track in the room&#39;s <a href="./rooms#room-properties">Properties</a>.</li></ul><h2 id="reading-a-midi-file" tabindex="-1">Reading a MIDI file <a class="header-anchor" href="#reading-a-midi-file" aria-label="Permalink to &quot;Reading a MIDI file&quot;">​</a></h2><p>Select a <code>.mid</code> file under <strong>Asset files</strong>, or press the piano button on a MIDI track, to see it as a piano roll. The view is read only.</p><ul><li>The track list gives each track&#39;s channel, instrument and note count. Click a track to pick it out, or use the eye to hide it. Instrument names follow General MIDI numbering, which your soundfont may not match.</li><li>The ruler shows bars, tempo, time signature and markers. The lane under the notes shows velocity.</li><li>Point at a note for its pitch, velocity, track, bar and length.</li><li><strong>Ctrl + wheel</strong> zooms time and <strong>Ctrl + Shift + wheel</strong> zooms the keys. The fit button shows the whole file again.</li></ul><h2 id="listening" tabindex="-1">Listening <a class="header-anchor" href="#listening" aria-label="Permalink to &quot;Listening&quot;">​</a></h2><p>Sound effects play in the studio. Music formats are converted when the ROM is built, so you hear them in the <a href="./build-and-play">Play</a> panel, not in the Audio list. There is no waveform or ROM-size estimate for audio yet.</p><h2 id="in-the-game" tabindex="-1">In the game <a class="header-anchor" href="#in-the-game" aria-label="Permalink to &quot;In the game&quot;">​</a></h2><p>The build helper generates <code>audio::TRACKS</code>, <code>SFX</code> and index constants; see <a href="./making-a-game">Making a game with it</a>.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("guide/audio.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const audio = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  audio as default
};
