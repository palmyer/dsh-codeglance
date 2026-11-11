window.__ModuleLoader__.load({
  id: '@local/dsh-codeglance',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    /* ------------------------------------------------------------------ *
     * Session minimap — a CodeGlance-style overview of the whole
     * conversation, docked against the right edge of the conversation
     * column.
     *
     * The map is built from the Chat view's own row elements
     * (`[data-chat-anchor-key]`, one per flow item) so it mirrors what is
     * actually on screen. Rows the official CSS treats as empty are
     * skipped, which is what keeps the map free of blank bands.
     * ------------------------------------------------------------------ */

    const WIDTH = 62;
    const PAD = 5;
    /** Smallest thumb the map draws, so a huge session stays grabbable. */
    const MIN_THUMB = 12;

    /* ------------------------------------------------------------------ *
     * Settings
     *
     * Stored in localStorage and published through a tiny store, so the
     * settings page and the map stay in sync without a Host round-trip.
     * Every default reproduces the behaviour that shipped before settings
     * existed, so an untouched profile looks the same.
     * ------------------------------------------------------------------ */

    const SETTINGS_KEY = 'dsh-codeglance:settings';

    const DEFAULTS = {
      // Geometry
      width: 62,
      inset: 10,
      opacity: 0.82,
      // Spacing, in map pixels
      barHeight: 1,
      minGap: 1,
      // Colours: three explicit inks. The user's words are DeepSeek blue at
      // full strength, the answer is a deep grey, and the machinery is a
      // light grey. `proseOpacity` is how far the answer sits toward the
      // theme's foreground ink: high enough to read as "deep", low enough
      // that the blue question stays the most prominent mark.
      proseOpacity: 0.42,      codeOpacity: 0.3,
      tableOpacity: 0.26,
      mediaOpacity: 0.42,
      thinkingOpacity: 0.14,
      toolOpacity: 0.14,
      // Accent hue for the reader's own words
      userHue: 'brand',
      // Accent hue for images and embeds
      mediaHue: 'warn',
      // Folding
      foldThinking: false,
      foldedThinkingLines: 1,
      // Behaviour
      hideOnNarrow: true,
      minColumn: 480,
      showViewport: true,
      // Which side of the conversation column the map docks to.
      side: 'right',
      // Hide the shipped conversation rail (the message navigator that some
      // profiles install) so the two never fight for the same edge.
      hideRail: false,
      // Hide dsh-md-plus's floating gear button. It is fixed at the bottom
      // right, exactly where the map sits, so it overlaps by default.
      hideRailGear: true,
    };

    const HUE_TOKENS = {
      brand: 'var(--dsw-alias-state-business-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      neutral: 'var(--dsw-alias-label-primary)',
    };

    function clampNumber(value, min, max, fallback) {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(min, Math.min(max, n));
    }

    function normalizeSettings(raw) {
      const s = raw !== null && typeof raw === 'object' ? raw : {};
      const bool = (v, d) => (typeof v === 'boolean' ? v : d);
      return {
        width: Math.round(clampNumber(s.width, 28, 200, DEFAULTS.width)),
        inset: Math.round(clampNumber(s.inset, 0, 200, DEFAULTS.inset)),
        opacity: clampNumber(s.opacity, 0.2, 1, DEFAULTS.opacity),
        barHeight: Math.round(clampNumber(s.barHeight, 1, 4, DEFAULTS.barHeight)),
        minGap: Math.round(clampNumber(s.minGap, 1, 6, DEFAULTS.minGap)),
        proseOpacity: clampNumber(s.proseOpacity, 0.35, 1, DEFAULTS.proseOpacity),
        codeOpacity: clampNumber(s.codeOpacity, 0.05, 1, DEFAULTS.codeOpacity),
        tableOpacity: clampNumber(s.tableOpacity, 0.05, 1, DEFAULTS.tableOpacity),
        mediaOpacity: clampNumber(s.mediaOpacity, 0.05, 1, DEFAULTS.mediaOpacity),
        mediaHue: s.mediaHue in HUE_TOKENS ? s.mediaHue : DEFAULTS.mediaHue,
        thinkingOpacity: clampNumber(s.thinkingOpacity, 0.03, 1, DEFAULTS.thinkingOpacity),
        toolOpacity: clampNumber(s.toolOpacity, 0.03, 1, DEFAULTS.toolOpacity),
        userHue: s.userHue in HUE_TOKENS ? s.userHue : DEFAULTS.userHue,
        foldThinking: bool(s.foldThinking, DEFAULTS.foldThinking),
        foldedThinkingLines: Math.round(clampNumber(s.foldedThinkingLines, 1, 6, DEFAULTS.foldedThinkingLines)),
        hideOnNarrow: bool(s.hideOnNarrow, DEFAULTS.hideOnNarrow),
        minColumn: Math.round(clampNumber(s.minColumn, 320, 1600, DEFAULTS.minColumn)),
        showViewport: bool(s.showViewport, DEFAULTS.showViewport),
        side: s.side === 'left' ? 'left' : (s.side === 'right' ? 'right' : DEFAULTS.side),
        hideRail: bool(s.hideRail, DEFAULTS.hideRail),
        hideRailGear: bool(s.hideRailGear, DEFAULTS.hideRailGear),
      };
    }

    function readStoredSettings() {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        return normalizeSettings(raw === null ? {} : JSON.parse(raw));
      } catch (error) {
        return normalizeSettings({});
      }
    }

    let settings = readStoredSettings();
    const settingsListeners = new Set();

    function settingsSnapshot() {
      return settings;
    }

    function subscribeSettings(fn) {
      settingsListeners.add(fn);
      return () => settingsListeners.delete(fn);
    }

    function updateSettings(patch) {
      settings = normalizeSettings({ ...settings, ...patch });
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch (error) {
        // A full or blocked store must not break the map.
      }
      for (const fn of settingsListeners) fn();
    }

    function resetSettings() {
      settings = normalizeSettings({});
      try {
        localStorage.removeItem(SETTINGS_KEY);
      } catch (error) {
        // ignore
      }
      for (const fn of settingsListeners) fn();
    }

    /** Subscribe a component to the settings store. */
    function useSettings() {
      const [snap, setSnap] = React.useState(settingsSnapshot);
      React.useEffect(() => subscribeSettings(() => setSnap(settingsSnapshot())), []);
      return snap;
    }

    /**
     * Line boxes collected per row.
     *
     * A rendered line is one painted bar, exactly like CodeGlance, but the
     * cost is one DOM rect per line per measure. This cap keeps a single
     * enormous row (a 2000-line log dump) from dominating a remeasure; rows
     * past it still paint, just at the capped resolution.
     */
    const MAX_LINES_PER_ROW = 240;
    /**
     * Line boxes collected for the whole session in one measure.
     *
     * The painted map is at most a few hundred pixels tall, so bars beyond
     * the map's own pixel height are visually indistinguishable — they just
     * cost DOM nodes. 4000 keeps a long session faithful while bounding the
     * element count a remeasure can create.
     */
    const MAX_LINES_TOTAL = 4000;
    const SCROLL_ATTR = 'data-conversation-scroll';
    const ROW_SELECTOR = '[data-chat-anchor-key]:not([hidden]):not([hidden] *)';

    /* Theme-aware palette.
     *
     * `--dsw-alias-brand-primary` is the *foreground* brand color and
     * resolves to near-black in dark mode (#0f1115), so it is unusable for
     * marks drawn on a dark panel. `--dsw-alias-state-business-primary`
     * resolves to #4176e6 in both themes and stays visible either way.
     *
     * Weight order, heaviest to faintest: the reader's own questions carry
     * the most weight, assistant prose next, code blocks lighter still
     * (they are a surface, not the conversation's voice), and thinking /
     * tool activity faintest because it is incidental machinery. */
    function buildCss(s) {
      // Explicit colours, not one grey at different opacities. The user's
      // words are DeepSeek blue, the answer is a deep grey, and the
      // machinery (thinking, tool calls) is a light grey — three clearly
      // different tones, so a reply never reads as the work that made it.
      //
      // The answer uses the theme's primary ink at full opacity: mixing it
      // with transparent *and* lowering opacity washed it to mid-grey, which
      // is why it did not read as "deep". The slider now selects how far
      // toward the primary ink the answer sits, with no second dilution.
      const hue = HUE_TOKENS[s.userHue] || HUE_TOKENS.brand;
      const answerPct = Math.round(Math.min(1, Math.max(0.35, s.proseOpacity)) * 100);
      const answerInk = `color-mix(in srgb, var(--dsw-alias-label-primary) ${answerPct}%, var(--dsw-alias-label-tertiary))`;
      const faintInk = 'var(--dsw-alias-label-tertiary)';
      // Images are a different kind of thing from code: give them their own
      // tint so a picture in the conversation is distinguishable at a glance.
      const mediaInk = HUE_TOKENS[s.mediaHue] || HUE_TOKENS.warn;
      // Hover lifts the map, but never past the kind's own strength.
      const hover = (v, lift) => Math.min(1, Math.max(v, lift));
      return `
/* The frame is drawn with an INSET OUTLINE, not a border.
   A border takes layout space, so the track measured 2px less than the
   height the map was scaled into: every bar was a hair too tall and the
   thumb's bottom 2px were clipped by the track's own overflow, which is
   why it never quite settled into the rounded bottom corner. An outline
   is painted, not laid out, so the track's box is exactly the height the
   bars are scaled to. */
.cgRoot{position:fixed;z-index:18;box-sizing:border-box;display:flex;
  border-radius:7px;overflow:hidden;pointer-events:auto;user-select:none;
  background:var(--dsw-alias-bg-layer-1);
  outline:1px solid var(--dsw-alias-border-l1);outline-offset:-1px;
  box-shadow:0 1px 6px rgba(0,0,0,.10);
  opacity:${s.opacity};transition:opacity .16s ease,outline-color .16s ease}
.cgRoot:hover{opacity:1;outline-color:var(--dsw-alias-border-l2)}
/* The track spans the whole panel and insets its CONTENT with padding.
   A margin here (the old form) shrank the clickable area instead, so the
   last few pixels of the panel — exactly where you click to reach the end —
   landed on the root and did nothing. */
.cgTrack{position:relative;flex:1 1 auto;overflow:hidden;
  cursor:pointer;touch-action:none;box-sizing:border-box}
/* Bars and the thumb are positioned inside this inset box, so their 0..1
   coordinate space matches the height they are laid out in. Putting the
   inset on .cgTrack itself made absolute children resolve against the
   padding box, which shifted everything up by the padding and left the
   last few pixels unreachable. */
.cgInner{position:absolute;inset:${PAD}px}
.cgBlock{position:absolute;left:0;right:0}
/* Each bar carries both classes on the SAME element (class="cgLine cg-user"),
   so the kind selectors must be compound (.cgLine.cg-user), not descendant.
   Tones are carried by COLOUR, not opacity: three explicit inks keep the
   answer deep, the machinery light, and the user's words blue, and nothing
   is diluted twice. */
.cgLine{position:absolute;height:${s.barHeight}px;border-radius:.5px;
  background:${answerInk};opacity:1}
.cgLine.cg-user{background:${hue};opacity:1}
.cgLine.cg-code{background:${faintInk};opacity:${s.codeOpacity}}
.cgLine.cg-diagram{background:${faintInk};opacity:${s.codeOpacity}}
.cgLine.cg-table{background:${faintInk};opacity:${s.tableOpacity}}
.cgLine.cg-media{background:${mediaInk};opacity:${s.mediaOpacity}}
.cgLine.cg-tool{background:${faintInk};opacity:${s.toolOpacity}}
.cgLine.cg-thinking{background:${faintInk};opacity:${s.thinkingOpacity}}
.cgRoot:hover .cgLine{opacity:1}
.cgRoot:hover .cgLine.cg-user{opacity:1}
.cgRoot:hover .cgLine.cg-code{opacity:${hover(s.codeOpacity, 0.45)}}
.cgRoot:hover .cgLine.cg-diagram{opacity:${hover(s.codeOpacity, 0.45)}}
.cgRoot:hover .cgLine.cg-table{opacity:${hover(s.tableOpacity, 0.4)}}
.cgRoot:hover .cgLine.cg-media{opacity:${hover(s.mediaOpacity, 0.5)}}
.cgRoot:hover .cgLine.cg-tool{opacity:${hover(s.toolOpacity, 0.24)}}
.cgRoot:hover .cgLine.cg-thinking{opacity:${hover(s.thinkingOpacity, 0.24)}}
/* The thumb must accept the pointer, or it can never be grabbed: with
   pointer-events:none every press on it reached the track instead, so a
   drag was read as a jump and the thumb could not be pulled to the end.
   Presses anywhere else on the track still fall through to the track and
   jump. */
.cgViewport{position:absolute;left:-1px;right:-1px;border-radius:3px;
  pointer-events:auto;cursor:grab;
  background:${hue};opacity:.16;
  border:1px solid ${hue}}
.cgRoot:hover .cgViewport{opacity:.26}
.cgRoot.cgDragging .cgViewport{opacity:.36;cursor:grabbing}
.cgRoot.cgNoViewport .cgViewport{display:none;pointer-events:none}
.cgEmpty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:9px;letter-spacing:.05em;color:var(--dsw-alias-label-secondary);opacity:.5}
/* Settings page */
.cgSet{display:flex;flex-direction:column;gap:18px;padding:4px 0 24px}
.cgSetIntro{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.cgSetGroup{display:flex;flex-direction:column;gap:2px;
  border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:6px 14px;
  background:var(--dsw-alias-bg-layer-2)}
.cgSetGroupTitle{font-size:12px;font-weight:600;letter-spacing:.02em;
  color:var(--dsw-alias-label-secondary);padding:8px 0 4px}
.cgSetRow{display:flex;align-items:center;gap:16px;padding:10px 0;
  border-top:1px solid var(--dsw-alias-border-l1)}
.cgSetRow:first-of-type{border-top:none}
.cgSetMain{flex:1 1 auto;min-width:0}
.cgSetTitle{font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary)}
.cgSetDesc{font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.cgSetValue{font-size:12px;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-secondary);min-width:44px;text-align:right}
.cgSetSlider{width:150px;accent-color:var(--dsw-alias-state-business-primary)}
.cgSetSwitch{flex:none;width:38px;height:22px;border-radius:11px;border:1px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-1);position:relative;cursor:pointer;padding:0;
  transition:background .16s ease,border-color .16s ease}
.cgSetSwitch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;
  border-radius:50%;background:var(--dsw-alias-label-secondary);transition:left .16s ease,background .16s ease}
.cgSetSwitch[aria-checked="true"]{background:var(--dsw-alias-state-business-primary);
  border-color:var(--dsw-alias-state-business-primary)}
.cgSetSwitch[aria-checked="true"]::after{left:18px;background:#fff}
.cgSetSeg{display:inline-flex;gap:0;border:1px solid var(--dsw-alias-border-l2);
  border-radius:8px;overflow:hidden}
.cgSetSegBtn{appearance:none;border:0;background:transparent;cursor:pointer;
  font:inherit;font-size:12px;padding:5px 10px;color:var(--dsw-alias-label-secondary)}
.cgSetSegBtn[data-active]{background:var(--dsw-alias-state-business-primary);color:#fff}
.cgSetFoot{display:flex;gap:10px;align-items:center}
.cgSetReset{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;
  background:transparent;font:inherit;font-size:12px;padding:6px 12px;cursor:pointer;
  color:var(--dsw-alias-label-primary)}
.cgSetReset:hover{border-color:var(--dsw-alias-label-secondary)}
`;
    }


    /** Rendered height of one body line: the shipped `line-height` is 24px. */
    const LINE_HEIGHT = 24;

    /* ---------------------------------------------------------------- *
     * Classification
     * ---------------------------------------------------------------- */

    /** Row flavour from the flow kind the Chat view stamps on each item. */
    function kindOf(el, key) {
      const flowKind = el.getAttribute('data-chat-flow-kind') || '';
      // Reasoning is an assistant-step too, so the flow kind alone cannot
      // tell thinking apart from the actual answer. The Chat view marks it
      // with data-chat-group-part="reasoning", and marks rows folded into a
      // turn's process with data-turn-process-member: both are machinery,
      // not the reply, and must stay the faintest thing on the map.
      const groupPart = el.getAttribute('data-chat-group-part') || '';
      if (groupPart === 'reasoning') return 'thinking';
      if (el.hasAttribute('data-turn-process-member')) return 'thinking';

      if (flowKind === 'user' || flowKind === 'steering' || flowKind === 'question-reply') return 'user';
      if (flowKind === 'tool-call' || flowKind === 'turn-process') return 'tool';
      if (flowKind === 'assistant-step') return 'assistant';
      if (key.indexOf('input-message') >= 0) return 'user';
      if (key.indexOf('call:') === 0) return 'tool';
      return 'assistant';
    }

    /**
     * Split a row into the coloured segments it is actually made of.
     *
     * A message is not one thing: it is prose, then a code block, then more
     * prose, with thinking and tool activity folded in between. Painting the
     * whole row in one colour is what produced a solid green slab wherever a
     * reply happened to contain code.
     *
     * Each segment is measured from the real element, so segments also
     * follow the thinking and tool blocks as the reader expands and
     * collapses them: a collapsed block has no height and contributes
     * nothing, an expanded one contributes its full height.
     *
     * @param el - one chat row.
     * @param rowTop - the row's document-relative top (unused for geometry;
     *   the row's own rect is the origin, so callers cannot skew it).
     * @param rowHeight - the row's rendered height.
     * @param lineLimit - total line boxes to collect for this row.
     * @returns segments in document order, each `{kind, top, height, lines}`.
     */
    function segmentsOf(el, rowTop, rowHeight, lineLimit) {
      const base = kindOf(el, el.getAttribute('data-chat-anchor-key') || '');
      // Take the origin from the row itself: both the row and its blocks are
      // measured in viewport coordinates, so mixing in a caller-supplied
      // document offset would shift every segment.
      const rowRect = el.getBoundingClientRect();
      const origin = rowRect.top;
      const leftEdge = rowRect.left;
      const budget = Math.max(1, lineLimit === undefined ? MAX_LINES_PER_ROW : lineLimit);

      // Measure the row's text ONCE. Measuring per segment re-walked the
      // whole row for every block and burned the budget several times over,
      // which is why most segments came back with no line boxes at all.
      const allLines = rectsOfText(el, origin, budget).lines;

      // Thinking / tool activity is a collapsible block: only its rendered
      // height counts, which is what makes the map follow expand/collapse.
      const segments = [];

      // Walk the row's direct content in visual order. Anything that is a
      // code block, diagram, table or image becomes its own segment;
      // everything else belongs to the row's base kind.
      const blocks = el.querySelectorAll(
        '.md-code-block, .md-plus-mmd, .md-plus-semantic-table, [data-step-process-content], img, figure, video, canvas',
      );
      if (blocks.length === 0) {
        segments.push({
          kind: base,
          top: 0,
          height: rowHeight,
          left: leftEdge,
          width: rowRect.width,
          lines: allLines,
        });
        return segments;
      }

      // Collect the block ranges first, then hand each line box to the range
      // it falls inside. Prose keeps the base kind; a block takes its own.
      const ranges = [];
      for (const block of blocks) {
        const rect = block.getBoundingClientRect();
        if (rect.height < 1) continue;

        // `kind` exists only to pick a colour.
        const isDiagram = block.classList.contains('md-plus-mmd');
        const isProcess = block.hasAttribute('data-step-process-content');
        const tag = block.tagName === undefined ? '' : block.tagName.toLowerCase();
        const isMedia = tag === 'img' || tag === 'figure' || tag === 'video' || tag === 'canvas';
        const innerTable = tag === 'table' ? null : block.querySelector('table');
        const isTable = block.classList.contains('md-plus-semantic-table') || innerTable !== null;
        const kind = isProcess
          ? 'thinking'
          : (isMedia ? 'media' : (isDiagram ? 'diagram' : (isTable ? 'table' : 'code')));

        // Width and height come from one call, for every block. The only
        // choice is WHICH node to ask: a table is nested inside a scroll
        // wrapper that spans the column, so its content width lives on the
        // <table> itself. Everything else is its own node.
        const subject = isTable ? (innerTable || block) : block;
        const own = subject.getBoundingClientRect();

        // Clip to the block's box: a table wider than its wrapper scrolls
        // horizontally, so the map shows the part the reader can see.
        const visLeft = Math.max(own.left, rect.left);
        const visRight = Math.min(own.left + own.width, rect.left + rect.width);
        const boxLeft = visLeft;
        const boxWidth = Math.max(1, visRight - visLeft);
        // Vertical extent is the block's own rendered box: that is what the
        // reader sees, and it is what changes when a block collapses.
        const boxTop = rect.top;
        const boxHeight = rect.height;

        // Read the REAL disclosure state of a process block. The Chat view
        // puts the expandable content in `[data-step-process-body]` and
        // marks its state on the toggle; when it is closed the body is
        // hidden or empty, and the block's own height is just a summary row.
        // `collapsed` records that so the map can keep a floor for it.
        let collapsed = false;
        if (isProcess) {
          const body = block.querySelector('[data-step-process-body]') || block;
          const open = body.getAttribute('data-open') !== null
            || body.hasAttribute('data-open')
            || block.getAttribute('aria-expanded') === 'true';
          const bodyBoxes = body.getClientRects === undefined
            ? 0
            : body.getClientRects().length;
          collapsed = !open || bodyBoxes === 0;
        }
        ranges.push({
          top: boxTop - origin,
          height: boxHeight,
          kind,
          left: boxLeft,
          width: boxWidth,
          collapsed,
        });
      }
      ranges.sort((a, b) => a.top - b.top);

      // Build segments covering the row top to bottom, alternating the base
      // kind's gaps with the blocks between them.
      let cursor = 0;
      for (const range of ranges) {
        if (range.top > cursor) {
          segments.push({
            kind: base,
            top: cursor,
            height: range.top - cursor,
            left: leftEdge,
            lines: [],
          });
        }
        segments.push({
          kind: range.kind,
          top: range.top,
          height: range.height,
          left: range.left,
          // The measured box travels with the segment: buildBlocks paints
          // exactly the area the element occupies.
          width: range.width,
          lines: [],
          surface: true,
          collapsed: range.collapsed,
        });
        cursor = Math.max(cursor, range.top + range.height);
      }
      if (cursor < rowHeight - 1) {
        segments.push({
          kind: base,
          top: cursor,
          height: rowHeight - cursor,
          left: leftEdge,
          lines: [],
        });
      }

      // Distribute the measured text lines across the segments by position.
      //
      // `allLines` came from the ROW's text walker, which descends into
      // blocks too. Those lines must not be handed to a surface segment: a
      // surface is painted from its own box, and giving it text lines made
      // its shape depend on whether the walker happened to see them. Text
      // lines belong to the prose segments only.
      for (const line of allLines) {
        for (const segment of segments) {
          if (segment.surface === true) continue;
          if (line.top >= segment.top - 1 && line.top < segment.top + segment.height) {
            segment.lines.push(line);
            break;
          }
        }
      }

      // Every block type needs a fallback shape for when its own line boxes
      // are unavailable. A code block normally reports one box per source
      // line, but a block the browser has not laid out yet (scrolled out of
      // a `content-visibility` subtree, or measured before highlight lands)
      // reports none — and without a fallback it painted nothing at all,
      // which is why code appeared only while it was on screen.
      for (const segment of segments) {
        const isSurface = segment.kind === 'code'
          || segment.kind === 'diagram'
          || segment.kind === 'table'
          || segment.kind === 'media';
        if (isSurface && segment.lines.length === 0) {
          const width = Math.max(1, segment.width === undefined ? 200 : segment.width);
          const rows = Math.max(1, Math.min(60, Math.round(segment.height / LINE_HEIGHT)));
          const step = segment.height / rows;
          for (let i = 0; i < rows; i++) {
            segment.lines.push({
              top: segment.top + i * step,
              left: segment.left,
              width,
              height: step,
            });
          }
        }
      }

      // "Fold thinking" is applied in buildBlocks, where a tool run's bars
      // are actually created: segmentsOf leaves their `lines` empty because
      // the block carries no measurable text.

      return segments;
    }

    /**
     * True when a row paints nothing the reader can see.
     *
     * The shipped stylesheet drops flow items that are `:empty` or whose
     * node slot renders empty (`:has(>[data-slot="conversation.chat.node"]:empty)`).
     * Those still carry an anchor and a box, so measuring them without this
     * filter painted long blank bands into the map.
     */
    function isBlankRow(el) {
      // The reader's own messages always count, even when they hold no text:
      // an image-only question still has a body and must stay on the map.
      const flowKind = el.getAttribute('data-chat-flow-kind') || '';
      if (flowKind === 'user' || flowKind === 'steering' || flowKind === 'question-reply') {
        return el.hasAttribute('hidden');
      }
      // Visibility is decided by the DOM, not by the fold marker. A row can
      // carry `data-turn-process-hidden` while a collapse transition still
      // gives it height; dropping it here made the map jump ahead of what
      // the reader actually sees. `hidden` (or a zero rect) is the real
      // signal, and readLayout already skips zero-height rows.
      if (el.hasAttribute('hidden')) return true;
      if (el.matches(':empty')) return true;
      const slot = el.firstElementChild;
      if (slot !== null
        && slot.getAttribute('data-slot') === 'conversation.chat.node'
        && slot.matches(':empty')) return true;
      return false;
    }

    /** Collapse a row's text to one line, bounded so huge rows stay cheap. */
    function textOf(el) {
      const raw = el.textContent || '';
      if (raw.length === 0) return '';
      return raw.replace(/\s+/g, ' ').trim().slice(0, 4000);
    }

    /**
     * Read the boxes a Range reports for its text.
     *
     * `Range.getClientRects()` returns one rect per visual line, each with
     * the line's real top, height, left edge (indentation) and width (how far
     * the text runs). That is the browser's own layout answer, which is what
     * makes the map a true per-line mirror instead of an estimate.
     *
     * Blocks do not need this: a block's box comes straight from
     * `getBoundingClientRect()`, so there is no per-kind strategy anywhere.
     *
     * @param source - a `Range`.
     * @param originTop - viewport top to measure against.
     * @param limit - stop after this many boxes, so huge rows stay cheap.
     * @returns `{lines: Array<{top,left,width,height}>, truncated: boolean}`.
     */
    function boxesFrom(source, originTop, limit) {
      const lines = [];
      if (source === null || source === undefined || typeof source.getClientRects !== 'function') {
        return { lines, truncated: false };
      }
      let truncated = false;
      const rects = source.getClientRects();
      for (const rect of rects) {
        if (rect.height < 1 || rect.width < 1) continue;
        lines.push({
          top: rect.top - originTop,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
        if (lines.length >= limit) {
          truncated = true;
          break;
        }
      }
      return { lines, truncated };
    }

    /**
     * Boxes of the text inside an element: one per visual line, carrying the
     * exact indentation and how far the line runs.
     */
    function rectsOfText(root, originTop, limit) {
      const lines = [];
      let truncated = false;

      if (typeof document.createRange !== 'function') {
        return { lines, truncated };
      }

      const range = document.createRange();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (node.nodeValue === null || node.nodeValue.trim() === '') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      let node = walker.nextNode();
      while (node !== null) {
        range.selectNodeContents(node);
        const measured = boxesFrom(range, originTop, limit - lines.length);
        for (const line of measured.lines) lines.push(line);
        if (measured.truncated || lines.length >= limit) {
          truncated = true;
          break;
        }
        node = walker.nextNode();
      }

      return { lines, truncated };
    }

    /**
     * Characters that fill one line of the conversation column.
     *
     * Read from the shipped variables rather than assumed: the column is
     * `--dsh-chat-content-width` (748px default) at
     * `--dsh-content-font-size` (14px default). A CJK glyph is about one
     * em wide and a Latin glyph about half, so the estimate blends them;
     * being close matters more than being exact, since the value only
     * decides how many visual lines a row's text is worth.
     */
    function measureCharsPerLine(scrollport, box) {
      const style = getComputedStyle(scrollport);
      const contentWidth = parseFloat(style.getPropertyValue('--dsh-chat-content-width')) || 748;
      const fontSize = parseFloat(style.getPropertyValue('--dsh-content-font-size')) || 14;
      // The rendered column is the smaller of the configured width and the
      // space actually available, so a narrow window must shrink the count.
      const usable = Math.min(contentWidth, Math.max(240, box.width - 48));
      const em = fontSize > 0 ? fontSize : 14;
      // ~1em per CJK glyph, ~0.5em per Latin; conversations mix both.
      return Math.max(12, Math.round(usable / (em * 0.72)));
    }

    /* ---------------------------------------------------------------- *
     * Geometry
     * ---------------------------------------------------------------- */

    function readLayout(scrollport) {
      const box = scrollport.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return null;

      const origin = box.top - scrollport.scrollTop;
      const rows = [];
      // One budget for the whole measure: the sum of per-row line boxes is
      // what actually costs time, so the cap belongs at session level.
      let budget = MAX_LINES_TOTAL;

      for (const el of scrollport.querySelectorAll(ROW_SELECTOR)) {
        if (isBlankRow(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.height < 1) continue;
        const key = el.getAttribute('data-chat-anchor-key') || '';
        const top = rect.top - origin;
        const rowBudget = Math.max(1, Math.min(MAX_LINES_PER_ROW, budget));
        const segments = segmentsOf(el, top, rect.height, rowBudget);
        for (const segment of segments) {
          budget = Math.max(0, budget - (segment.lines === undefined ? 0 : segment.lines.length));
        }
        rows.push({
          key,
          kind: kindOf(el, key),
          top,
          height: rect.height,
          text: textOf(el),
          // Split into the prose / code / diagram / activity runs the row is
          // made of, so one row can paint several colours.
          segments,
        });
      }

      rows.sort((a, b) => a.top - b.top);

      // The Chat view pads the tail with a spacer so a closing fold can keep
      // the reader still. It inflates scrollHeight without painting anything,
      // so scaling by the raw value left a blank band at the bottom of the
      // map. Read it the way the Chat view does — its inline height — so the
      // map's scale and its scroll range agree.
      const spacer = scrollport.querySelector('[data-chat-turn-spacer]');
      const spacerHeight = spacer === null
        ? 0
        : (Number.parseFloat(spacer.style.height) || 0);

      // Length must be measured against the width text actually occupies,
      // not the scrollport. The scrollport includes the column's side
      // padding and can be far wider than the centred content column, which
      // made every line look short.
      let widest = 0;
      let maxRight = -Infinity;
      for (const row of rows) {
        for (const segment of row.segments) {
          for (const line of segment.lines) {
            const run = line.left - box.left + line.width;
            if (run > widest) widest = run;
            const right = line.left + line.width;
            if (right > maxRight) maxRight = right;
          }
        }
      }

      const style = getComputedStyle(scrollport);
      const configured = parseFloat(style.getPropertyValue('--dsh-chat-content-width')) || 748;

      // The column's own geometry, not the content's extremes: a narrow
      // right-aligned bubble would otherwise drag the left edge rightwards
      // and collapse every user line to zero indentation.
      const contentWidth = Math.min(configured, box.width);
      const columnLeft = box.left + (box.width - contentWidth) / 2;

      // Right edge of the content: the widest measured run, so a right-
      // aligned message reaches the map's right side like it does on screen.
      const measuredRight = maxRight === -Infinity ? columnLeft + contentWidth : maxRight;
      const textWidth = Math.round(Math.max(
        240,
        Math.min(Math.max(widest, measuredRight - columnLeft, contentWidth * 0.6), box.width),
      ));

      return {
        frame: {
          top: Math.round(box.top),
          height: Math.round(box.height),
          // Distance from each viewport edge to the conversation column.
          // The panel sits just inside the column on the chosen side.
          right: Math.max(0, Math.round(window.innerWidth - box.right) + settings.inset),
          left: Math.max(0, Math.round(box.left) + settings.inset),
        },
        columnWidth: textWidth,
        // True left edge of the centred content column.
        columnLeft: Math.round(columnLeft),
        charsPerLine: measureCharsPerLine(scrollport, box),
        total: Math.max(1, scrollport.scrollHeight - spacerHeight),
        rows,
      };
    }

    function readScroll(scrollport) {
      return { top: scrollport.scrollTop, view: scrollport.clientHeight };
    }

    /* ---------------------------------------------------------------- *
     * Tracking
     * ---------------------------------------------------------------- */

    function useMinimap(sessionId) {
      const [layout, setLayout] = React.useState(null);
      const [scroll, setScroll] = React.useState({ top: 0, view: 0 });

      React.useEffect(() => {
        let frame = 0;
        let mutationTimer = 0;
        let scrollport = null;
        let observer = null;

        const measure = () => {
          frame = 0;
          scrollport = document.querySelector('[' + SCROLL_ATTR + ']');
          if (scrollport === null) {
            setLayout(null);
            return;
          }
          setLayout(readLayout(scrollport));
          setScroll(readScroll(scrollport));
        };

        const schedule = () => {
          if (frame !== 0) return;
          frame = window.requestAnimationFrame(measure);
        };

        const onScroll = () => {
          if (scrollport === null) return;
          setScroll(readScroll(scrollport));
        };

        // Throttle, never debounce: a streaming reply mutates the DOM
        // continuously and a debounce would starve the measure.
        const onMutate = () => {
          if (mutationTimer !== 0) return;
          mutationTimer = window.setTimeout(() => {
            mutationTimer = 0;
            schedule();
          }, 150);
        };

        schedule();

        const mutation = new MutationObserver(onMutate);
        // `attributes` matters as much as childList here: the Chat view
        // collapses a turn's process by toggling the `hidden` attribute on
        // existing rows, which changes their measured height without adding
        // or removing any node. Watching only childList left the map stale
        // after a collapse.
        mutation.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['hidden', 'style', 'class', 'data-turn-process-hidden'],
        });

        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(schedule);
          observer.observe(document.documentElement);
          const probe = document.querySelector('[' + SCROLL_ATTR + ']');
          if (probe !== null) observer.observe(probe);
        }

        // Scroll does not bubble; capture it at the document.
        document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        window.addEventListener('resize', schedule);

        // Settle loop for late layout (fonts, paged history).
        let ticks = 0;
        const settle = window.setInterval(() => {
          schedule();
          if (++ticks > 16) window.clearInterval(settle);
        }, 250);

        return () => {
          if (frame !== 0) window.cancelAnimationFrame(frame);
          window.clearTimeout(mutationTimer);
          window.clearInterval(settle);
          mutation.disconnect();
          if (observer !== null) observer.disconnect();
          document.removeEventListener('scroll', onScroll, { capture: true });
          window.removeEventListener('resize', schedule);
        };
      }, [sessionId]);

      return [layout, scroll];
    }

    /* ---------------------------------------------------------------- *
     * Painting
     * ---------------------------------------------------------------- */

    const PITCH = 3;
    const MAX_LINES = 400;

    /**
     * Turn measured rows into the bars the map paints.
     *
     * Each bar is a real rendered line: its vertical position comes from the
     * line box the browser laid out, its width from how far that line's text
     * actually runs, and its left edge from the line's own indentation. That
     * is the same information IntelliJ's CodeGlance draws from the editor's
     * line model — per-line length, indent and colour — read here from the
     * DOM instead of a document buffer.
     *
     * Rows with no line boxes (a diagram, or a browser without
     * `Range.getClientRects`) fall back to a synthetic stack so the map is
     * never empty.
     *
     * @param rows - measured rows, in document order.
     * @param trackHeight - painted height of the map.
     * @param total - scrollable content height the map represents.
     * @param charsPerLine - characters that fill one line of the column.
     * @param columnLeft - viewport left edge the indentation is measured from.
     * @param columnWidth - usable text width of the conversation column.
     */
    function buildBlocks(rows, trackHeight, total, charsPerLine, columnLeft, columnWidth) {
      const scale = trackHeight / total;
      const per = Math.max(12, charsPerLine);
      const left = columnLeft === undefined ? 0 : columnLeft;
      const usable = Math.max(120, columnWidth === undefined ? 700 : columnWidth);
      const blocks = [];
      // Minimum gap between painted bars, in map pixels. A 1px bar with a 1px
      // gap reads as a continuous column, which is what CodeGlance looks
      // like; spacing them further apart made the map look sparse.
      const MIN_GAP = settings.minGap;

      for (const row of rows) {
        const rowTop = row.top * scale;
        const rowHeight = Math.max(1, row.height * scale);
        if (rowTop + rowHeight < 0 || rowTop > trackHeight) continue;

        const segments = row.segments !== undefined && row.segments.length > 0
          ? row.segments
          : [{ kind: row.kind, top: 0, height: row.height, lines: [] }];

        const lines = [];
        // Track the last painted Y per row: a global cursor let one row's
        // tail swallow the next row's head, which produced uneven gaps.
        let lastY = -Infinity;
        for (const segment of segments) {
          const segTop = rowTop + segment.top * scale;
          const segHeight = Math.max(1, segment.height * scale);
          if (segTop + segHeight < 0 || segTop > trackHeight) continue;

          const boxes = segment.lines === undefined ? [] : segment.lines;

          if (boxes.length > 0) {
            // Real line boxes: exact position, indent and length.
            for (const box of boxes) {
              const y = rowTop + box.top * scale;
              if (y < -2 || y > trackHeight + 2) continue;
              // Bars closer than MIN_GAP would merge into one smear.
              if (y - lastY < MIN_GAP) continue;
              lastY = y;
              // Position and length are each a share of the column, taken
              // straight from the line box. `left` is where the text starts
              // (so a right-aligned bubble starts far to the right) and
              // `width` is how far it runs — subtracting the indent again
              // double-counted it and shortened every line.
              const start = Math.max(0, Math.min(1, (box.left - left) / usable));
              const end = Math.max(start, Math.min(1, (box.left - left + box.width) / usable));
              lines.push({
                y,
                left: Math.round(start * 100),
                width: Math.max(2, Math.round((end - start) * 100)),
                kind: segment.kind,
              });
            }
            continue;
          }

          // Fallback: no measurable text, so paint the band itself.
          let bars = Math.max(1, Math.min(MAX_LINES, Math.round(segment.height / LINE_HEIGHT)));
          const isSurface = segment.kind === 'code'
            || segment.kind === 'diagram'
            || segment.kind === 'table'
            || segment.kind === 'media';

          // "Fold thinking" follows the REAL disclosure state, not a switch
          // of its own. The Chat view wraps a turn's reasoning and tool calls
          // in `[data-step-process-body]`, whose height is already the truth:
          // collapsed it is a summary row (tens of px), expanded it is the
          // full transcript. Because segmentsOf measures that element's real
          // rect, the map inherits the collapse for free — the only thing
          // this branch adds is a floor, so a run that collapses to a few
          // pixels still stays visible instead of vanishing.
          //
          // The old behaviour compressed every run to N bars regardless of
          // whether the reader had expanded it, which is what made the map
          // disagree with the transcript.
          if (settings.foldThinking
            && (segment.kind === 'tool' || segment.kind === 'thinking')
            && segment.collapsed === true) {
            bars = Math.min(bars, Math.max(1, settings.foldedThinkingLines));
          }

          // A surface has a real box: fill exactly the area it occupies
          // instead of a full-width slab. Code blocks, tables, diagrams and
          // images are often narrower than the column (or indented inside a
          // list), and painting them edge to edge both lied about their
          // width and left the reader guessing what the blank space was.
          const boxStart = Math.max(0, Math.min(1, (segment.left - left) / usable));
          const boxEnd = Math.max(
            boxStart,
            Math.min(1, (segment.left - left + segment.width) / usable),
          );
          const surfaceLeft = Math.round(boxStart * 100);
          const surfaceWidth = Math.max(2, Math.round((boxEnd - boxStart) * 100));

          const pitch = bars > 1 ? Math.max(2, segHeight / bars) : PITCH;
          for (let i = 0; i < bars; i++) {
            lines.push({
              y: segTop + i * pitch,
              left: isSurface ? surfaceLeft : 0,
              width: isSurface ? surfaceWidth : 26,
              kind: segment.kind,
            });
          }
        }

        blocks.push({ key: row.key, top: rowTop, height: rowHeight, lines });
      }

      return blocks;
    }

    function Minimap(props) {
      const s = useSettings();
      const { sessionId } = props;
      const [layout, scroll] = useMinimap(sessionId);
      const trackRef = React.useRef(null);
      const thumbRef = React.useRef(null);
      const dragRef = React.useRef(null);
      const [dragging, setDragging] = React.useState(false);

      /**
       * Move the thumb without re-rendering the map.
       *
       * A `pointermove` used to set React state, which re-rendered every
       * painted line — hundreds of nodes per frame — so the thumb visibly
       * trailed the cursor. Writing the thumb's transform directly keeps
       * dragging on the compositor; the state catches up when the drag ends.
       */
      const moveThumb = React.useCallback((scrollTop, maxScroll) => {
        const track = trackRef.current;
        const thumb = thumbRef.current;
        if (track === null || thumb === null) return;
        // Bars live in the track's content box (padding insets them), so the
        // thumb travels that height too.
        const box = track.getBoundingClientRect();
        const innerHeight = Math.max(1, box.height - PAD * 2);
        const thumbHeight = thumb.getBoundingClientRect().height;
        const travel = Math.max(0, innerHeight - thumbHeight);
        // `maxScroll` must be the SAME maximum the render divides by. This
        // used to recompute `scrollHeight - clientHeight` from the raw
        // scroller, which still counts the Chat view's tail spacer: that
        // maximum is larger than the real one, so every position came out
        // short by the spacer's share — the thumb stopped a visible gap
        // above the bottom and never reached the panel's rounded corner.
        const progress = Math.max(0, Math.min(1, scrollTop / Math.max(1, maxScroll)));
        thumb.style.top = progress * travel + 'px';
      }, []);

      /**
       * The real scrollable range of the conversation.
       *
       * The Chat view pads the tail with a spacer whose height it writes to
       * the element's inline style, and it computes its own floor as
       * `scrollHeight - parseFloat(spacer.style.height)`. Reading the
       * spacer's RENDERED height instead (its box can include margin or lag
       * a fold animation) made this plugin subtract more than the Chat view,
       * so its maximum was a little short: the top worked, the bottom never
       * quite arrived, by both click and drag.
       */
      const readRange = React.useCallback((scrollport) => {
        const spacer = scrollport.querySelector('[data-chat-turn-spacer]');
        // Match the Chat view exactly: the inline height, not the box.
        const spacerHeight = spacer === null
          ? 0
          : (Number.parseFloat(spacer.style.height) || 0);
        const content = Math.max(0, scrollport.scrollHeight - spacerHeight);
        return {
          content,
          view: scrollport.clientHeight,
          max: Math.max(0, content - scrollport.clientHeight),
        };
      }, []);

      /**
       * Map a pointer position to a scroll offset.
       *
       * Both sides work in the same normalized space: the pointer's place
       * inside the thumb's travel range (0..1) is the reader's place in the
       * document (0..1).
       *
       * Two things matter for the thumb to track the cursor exactly:
       *
       * 1. The scroll must be instant. The Chat view runs native smooth
       *    scrolls (`scrollTo({ behavior: 'smooth' })`) for its follow and
       *    turn jumps, and assigning `scrollTop` while one is running gets
       *    absorbed into that animation instead of moving immediately.
       *    `behavior: 'instant'` cancels it and lands at once.
       * 2. The thumb is positioned from the value we asked for, never from a
       *    read-back: `scrollTop` reads the old position until the next
       *    frame, so reading it here snapped the thumb back and forced a
       *    second scroll to catch up.
       */
      const applyScroll = React.useCallback((clientY) => {
        const track = trackRef.current;
        const scrollport = document.querySelector('[' + SCROLL_ATTR + ']');
        if (track === null || scrollport === null) return;

        // The track's padding insets the bars; the usable travel is the
        // content box, not the border box.
        const box = track.getBoundingClientRect();
        const innerTop = box.top + PAD;
        const innerHeight = box.height - PAD * 2;
        if (innerHeight <= 0) return;

        const thumb = track.querySelector('.cgViewport');
        const thumbHeight = thumb === null ? 0 : thumb.getBoundingClientRect().height;
        const travel = Math.max(1, innerHeight - thumbHeight);
        const drag = dragRef.current;

        // Two different gestures, two different spaces. Both are right for
        // what they do:
        //
        //  - DRAGGING the thumb must keep the grabbed point under the
        //    finger, so it maps into the thumb's travel range with the grab
        //    offset. 1:1, no dead zone, both ends reachable.
        //  - CLICKING the track is a jump. It maps the pointer's place along
        //    the FULL track, so every pixel of the track means a different
        //    position. Mapping a jump through the travel range instead (with
        //    a half-thumb offset, so the thumb's centre lands on the cursor)
        //    leaves the first and last half-thumb of the track all mapping
        //    to the same clamped value: a click down there did nothing, which
        //    is exactly the reported "within half a thumb of the bottom it
        //    stops jumping". The ends are what a reader reaches for most, so
        //    they must be the most responsive, not the least.
        const isDrag = drag !== null && drag.dragging === true;
        const ratio = isDrag
          ? (clientY - innerTop - drag.grab) / travel
          : (clientY - innerTop) / innerHeight;
        const clamped = Math.max(0, Math.min(1, ratio));

        // One range, shared by the write and the thumb, so the two can never
        // disagree.
        const range = readRange(scrollport);
        const target = clamped * range.max;

        scrollport.scrollTo({ top: target, behavior: 'instant' });
        // The browser may still clamp (content shorter than we think, a
        // layout change mid-gesture). Position the thumb from what actually
        // landed, falling back to the request when the read lags.
        const landed = scrollport.scrollTop;
        const shown = Math.abs(landed - target) <= 1 ? target : landed;
        // Pass the range's own maximum, the same one `target` was scaled
        // from. Handing over the raw scroll metrics made the thumb divide by
        // a larger number and stop short of the bottom.
        moveThumb(shown, range.max);
        // Remember the value we asked for. React re-renders with the scroll
        // state it last sampled, which is older than this write; without
        // this record the thumb would snap back to the stale position.
        if (dragRef.current !== null) dragRef.current.scrollTop = shown;
      }, [moveThumb, readRange]);

      const onPointerDown = React.useCallback((event) => {
        if (event.button !== 0) return;
        const track = trackRef.current;
        if (track === null) return;

        const view = track.querySelector('.cgViewport');
        const inside = view !== null && view.contains(event.target);
        // The grab offset only matters when the press starts on the thumb:
        // it keeps that exact spot under the cursor for the whole drag.
        const grab = inside
          ? event.clientY - view.getBoundingClientRect().top
          : 0;

        // Cancel any native smooth scroll already running (the Chat view
        // animates follow and turn jumps). Otherwise the first drag write
        // would be absorbed into that animation and the thumb would appear
        // stuck until the animation finished.
        const scrollport = document.querySelector('[' + SCROLL_ATTR + ']');
        if (scrollport !== null) {
          scrollport.scrollTo({ top: scrollport.scrollTop, behavior: 'instant' });
        }

        // Only a press ON the thumb starts a drag with a grab offset. A
        // press elsewhere on the track is a jump, and `applyScroll` must
        // treat it as one: marking every press as a drag made the jump use
        // the thumb's half-height offset, so the last half-thumb of the
        // track could never be reached.
        dragRef.current = {
          grab,
          raf: 0,
          pointerY: event.clientY,
          scrollTop: undefined,
          dragging: inside,
        };
        setDragging(true);
        track.setPointerCapture(event.pointerId);
        if (!inside) applyScroll(event.clientY);
      }, [applyScroll]);

      const onPointerMove = React.useCallback((event) => {
        const drag = dragRef.current;
        if (drag === null) return;
        // Coalesce pointer events to one scroll write per frame; a fast
        // drag otherwise queues dozens of writes per painted frame.
        if (drag.raf !== 0) return;
        const y = event.clientY;
        drag.raf = window.requestAnimationFrame(() => {
          const live = dragRef.current;
          if (live === null) return;
          live.raf = 0;
          live.pointerY = y;
          applyScroll(y);
        });
      }, [applyScroll]);

      const endDrag = React.useCallback((event) => {
        const drag = dragRef.current;
        if (drag === null) return;
        if (drag.raf !== 0) window.cancelAnimationFrame(drag.raf);
        dragRef.current = null;
        const track = trackRef.current;
        if (track !== null && track.hasPointerCapture(event.pointerId)) {
          track.releasePointerCapture(event.pointerId);
        }
        const scrollport = document.querySelector('[' + SCROLL_ATTR + ']');
        if (scrollport !== null) {
          // Adopt the position this gesture asked for, not whatever the
          // scrollport reports at this instant. Between the last write and
          // this handler the Chat view may still be settling (a follow
          // animation, a paging step), and reading early showed the OLD
          // position — the thumb jumped back and then travelled again.
          if (drag.scrollTop !== undefined) {
            scrollport.scrollTo({ top: drag.scrollTop, behavior: 'instant' });
          }
          setScroll(readScroll(scrollport));
        }
        setDragging(false);
      }, []);

      /**
       * While a drag runs, keep the scrollport on the position the gesture
       * asked for.
       *
       * The Chat view owns this element and reacts to its own scroll events:
       * a follow animation, a paging step, or a tail snap can write the
       * position back between our frames. Without this guard the thumb sat
       * under the cursor while the CONTENT slid away — the drag "worked" but
       * the reader saw the wrong part of the conversation.
       */
      React.useEffect(() => {
        if (!dragging) return undefined;
        let frame = 0;
        const guard = () => {
          const drag = dragRef.current;
          const scrollport = document.querySelector('[' + SCROLL_ATTR + ']');
          if (drag !== null && drag.scrollTop !== undefined && scrollport !== null) {
            if (Math.abs(scrollport.scrollTop - drag.scrollTop) > 1) {
              scrollport.scrollTo({ top: drag.scrollTop, behavior: 'instant' });
            }
          }
          frame = window.requestAnimationFrame(guard);
        };
        frame = window.requestAnimationFrame(guard);
        return () => {
          if (frame !== 0) window.cancelAnimationFrame(frame);
        };
      }, [dragging]);

      if (layout === null) return null;
      if (settings.hideOnNarrow && layout.columnWidth < settings.minColumn) return null;

      const trackHeight = Math.max(1, layout.frame.height - PAD * 2);
      const scale = trackHeight / layout.total;
      // Real line boxes are positioned in viewport coordinates, so the map
      // needs the column's left edge and usable text width to turn them into
      // relative indent and length.
      const blocks = buildBlocks(
        layout.rows,
        trackHeight,
        layout.total,
        layout.charsPerLine,
        layout.columnLeft,
        layout.columnWidth,
      );

      // The thumb is a scrollbar: its height is the visible fraction of the
      // content, and its travel is the track minus that height. Position and
      // drag share this one normalized ratio, so the thumb sits exactly
      // where the pointer left it.
      //
      // While a drag is running the scroll state lags the writes we just
      // made, so the render uses the drag's own target. Otherwise React
      // would paint the stale position over the thumb mid-gesture.
      const liveTop = dragRef.current !== null && dragRef.current.scrollTop !== undefined
        ? dragRef.current.scrollTop
        : scroll.top;
      const trueThumbHeight = Math.max(1, Math.min(trackHeight, scroll.view * scale));
      const thumbHeight = Math.max(MIN_THUMB, trueThumbHeight);
      const travel = Math.max(0, trackHeight - thumbHeight);
      const maxScroll = Math.max(1, layout.total - scroll.view);
      const progress = Math.max(0, Math.min(1, liveTop / maxScroll));
      const viewTop = progress * travel;

      // Each line carries its own kind, so one row can mix prose, code and
      // activity colours instead of painting the whole row one colour.
      const painted = blocks.map((block) => h('div', {
        key: block.key,
        className: 'cgBlock',
        style: { top: block.top + 'px', height: block.height + 'px' },
      }, block.lines.map((line, index) => h('span', {
        key: index,
        className: 'cgLine cg-' + line.kind,
        style: {
          top: line.y - block.top + 'px',
          left: (line.left === undefined ? 0 : line.left) + '%',
          width: line.width + '%',
        },
      }))));

      // Bars and thumb live inside the inset box, whose height is exactly
      // the space they are scaled into.
      const inner = h('div', { className: 'cgInner' },
        painted.length === 0 ? h('div', { className: 'cgEmpty' }, '—') : painted,
        h('div', {
          className: 'cgViewport',
          ref: thumbRef,
          style: { top: viewTop + 'px', height: thumbHeight + 'px' },
        }),
      );

      const track = h('div', {
        className: 'cgTrack',
        ref: trackRef,
        onPointerDown,
        onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
      }, inner);

      // Dock to the chosen side. Both offsets are measured from the
      // conversation column, so the panel hugs the text on either edge
      // instead of jumping to the viewport edge.
      const onLeft = s.side === 'left';
      const root = h('div', {
        className: 'cgRoot'
          + (dragging ? ' cgDragging' : '')
          + (s.showViewport ? '' : ' cgNoViewport')
          + (onLeft ? ' cgLeft' : ''),
        style: {
          top: layout.frame.top + 'px',
          height: layout.frame.height + 'px',
          right: onLeft ? 'auto' : layout.frame.right + 'px',
          left: onLeft ? layout.frame.left + 'px' : 'auto',
          width: s.width + 'px',
        },
        role: 'scrollbar',
        'aria-label': 'Session minimap',
        'aria-valuemin': 0,
        'aria-valuemax': Math.round(maxScroll),
        'aria-valuenow': Math.round(scroll.top),
      }, track);

      return ReactDOM.createPortal(root, document.body);
    }

    /* ---------------------------------------------------------------- *
     * Settings page
     * ---------------------------------------------------------------- */

    /** One labelled preference row: title, optional description, control. */
    function SettingRow(props) {
      return h('div', { className: 'cgSetRow' },
        h('div', { className: 'cgSetMain' },
          h('div', { className: 'cgSetTitle' }, props.title),
          props.desc ? h('div', { className: 'cgSetDesc' }, props.desc) : null),
        props.children);
    }

    function SettingToggle(props) {
      return h('button', {
        type: 'button',
        className: 'cgSetSwitch',
        role: 'switch',
        'aria-checked': props.value ? 'true' : 'false',
        'aria-label': props.label || '',
        onClick: () => props.onChange(!props.value),
      });
    }

    function SettingSlider(props) {
      return [
        h('input', {
          key: 'input',
          className: 'cgSetSlider',
          type: 'range',
          min: props.min,
          max: props.max,
          step: props.step || 1,
          value: props.value,
          'aria-label': props.label || '',
          onChange: (event) => props.onChange(Number(event.target.value)),
        }),
        h('span', { key: 'value', className: 'cgSetValue' }, props.format(props.value)),
      ];
    }

    function SettingSegment(props) {
      return h('div', { className: 'cgSetSeg', role: 'group', 'aria-label': props.label || '' },
        props.options.map((option) => h('button', {
          key: option.value,
          type: 'button',
          className: 'cgSetSegBtn',
          'data-active': props.value === option.value ? '' : undefined,
          onClick: () => props.onChange(option.value),
        }, option.label)));
    }

    function SettingsPage() {
      const s = useSettings();
      const pct = (v) => Math.round(v * 100) + '%';

      return h('div', { className: 'cgSet' },
        h('div', { className: 'cgSetIntro' },
          '会话缩略图（CodeGlance 式）的显示设置。改动立即生效，并保存在本机。'),

        // ---- 1. Colours -------------------------------------------------
        h('div', { className: 'cgSetGroup' },
          h('div', { className: 'cgSetGroupTitle' }, '配色'),
          h(SettingRow, { title: '我的提问颜色', desc: '提问始终是地图上最重的一笔' },
            h(SettingSegment, {
              value: s.userHue,
              label: '提问颜色',
              options: [
                { value: 'brand', label: '品牌蓝' },
                { value: 'success', label: '绿' },
                { value: 'warn', label: '琥珀' },
                { value: 'error', label: '红' },
                { value: 'neutral', label: '中性' },
              ],
              onChange: (v) => updateSettings({ userHue: v }),
            })),
          h(SettingRow, {
            title: '正式回答灰度',
            desc: '回答用主题的前景色（深灰）。调高更深、调低更浅；默认 62% 已明显重于思考',
          },
            h(SettingSlider, {
              value: s.proseOpacity, min: 0.35, max: 1, step: 0.05,
              label: '回答灰度', format: pct,
              onChange: (v) => updateSettings({ proseOpacity: v }),
            })),
          h(SettingRow, { title: '代码块强度', desc: '代码是块面，默认比正文淡' },
            h(SettingSlider, {
              value: s.codeOpacity, min: 0.05, max: 1, step: 0.05,
              label: '代码强度', format: pct,
              onChange: (v) => updateSettings({ codeOpacity: v }),
            })),
          h(SettingRow, { title: '表格强度', desc: 'Markdown 表格，按实际占位填满' },
            h(SettingSlider, {
              value: s.tableOpacity, min: 0.05, max: 1, step: 0.05,
              label: '表格强度', format: pct,
              onChange: (v) => updateSettings({ tableOpacity: v }),
            })),
          h(SettingRow, {
            title: '图片颜色',
            desc: '图片与嵌入内容单独着色，便于和代码、表格区分',
          },
            h(SettingSegment, {
              value: s.mediaHue,
              label: '图片颜色',
              options: [
                { value: 'warn', label: '琥珀' },
                { value: 'success', label: '绿' },
                { value: 'brand', label: '蓝' },
                { value: 'error', label: '红' },
                { value: 'neutral', label: '中性' },
              ],
              onChange: (v) => updateSettings({ mediaHue: v }),
            })),
          h(SettingRow, { title: '图片强度', desc: '图片区域按实际宽高填满，这里是它的浓淡' },
            h(SettingSlider, {
              value: s.mediaOpacity, min: 0.05, max: 1, step: 0.05,
              label: '图片强度', format: pct,
              onChange: (v) => updateSettings({ mediaOpacity: v }),
            })),
          h(SettingRow, { title: '思考过程强度', desc: '模型的推理过程，默认最浅，与正式回答拉开差距' },
            h(SettingSlider, {
              value: s.thinkingOpacity, min: 0.03, max: 1, step: 0.01,
              label: '思考过程强度', format: pct,
              onChange: (v) => updateSettings({ thinkingOpacity: v }),
            })),
          h(SettingRow, { title: '工具调用强度', desc: '读取文件、执行命令等调用，默认最浅' },
            h(SettingSlider, {
              value: s.toolOpacity, min: 0.03, max: 1, step: 0.01,
              label: '工具调用强度', format: pct,
              onChange: (v) => updateSettings({ toolOpacity: v }),
            })),
          h(SettingRow, { title: '面板整体透明度', desc: '未悬停时的不透明度' },
            h(SettingSlider, {
              value: s.opacity, min: 0.2, max: 1, step: 0.02,
              label: '面板透明度', format: pct,
              onChange: (v) => updateSettings({ opacity: v }),
            }))),

        // ---- 2. Folding --------------------------------------------------
        h('div', { className: 'cgSetGroup' },
          h('div', { className: 'cgSetGroupTitle' }, '折叠'),
          h(SettingRow, {
            title: '折叠思考内容',
            desc: '开启后，一段思考/工具过程在地图上压缩成一行，不再占据它真实的篇幅',
          },
            h(SettingToggle, {
              value: s.foldThinking,
              label: '折叠思考内容',
              onChange: (v) => updateSettings({ foldThinking: v }),
            })),
          h(SettingRow, { title: '折叠后保留行数', desc: '折叠的思考在地图上留几行' },
            h(SettingSlider, {
              value: s.foldedThinkingLines, min: 1, max: 6, step: 1,
              label: '折叠行数', format: (v) => v + ' 行',
              onChange: (v) => updateSettings({ foldedThinkingLines: v }),
            }))),

        // ---- 3. CodeGlance geometry -------------------------------------
        h('div', { className: 'cgSetGroup' },
          h('div', { className: 'cgSetGroupTitle' }, '缩略图尺寸'),
          h(SettingRow, { title: '宽度', desc: '地图条带宽度（px）' },
            h(SettingSlider, {
              value: s.width, min: 28, max: 200, step: 2,
              label: '宽度', format: (v) => v + 'px',
              onChange: (v) => updateSettings({ width: v }),
            })),
          h(SettingRow, { title: '距内容列距离', desc: '与正文列右缘的间距（px）' },
            h(SettingSlider, {
              value: s.inset, min: 0, max: 200, step: 2,
              label: '间距', format: (v) => v + 'px',
              onChange: (v) => updateSettings({ inset: v }),
            })),
          h(SettingRow, { title: '线条高度', desc: '每根线的粗细（px），越小越细腻' },
            h(SettingSlider, {
              value: s.barHeight, min: 1, max: 4, step: 1,
              label: '线条高度', format: (v) => v + 'px',
              onChange: (v) => updateSettings({ barHeight: v }),
            })),
          h(SettingRow, {
            title: '最小行间距',
            desc: '相邻两行之间至少留多少像素。调大会更疏朗，但长会话会丢细节',
          },
            h(SettingSlider, {
              value: s.minGap, min: 1, max: 6, step: 1,
              label: '最小行间距', format: (v) => v + 'px',
              onChange: (v) => updateSettings({ minGap: v }),
            }))),

        // ---- 4. Behaviour ------------------------------------------------
        h('div', { className: 'cgSetGroup' },
          h('div', { className: 'cgSetGroupTitle' }, '显示行为'),
          h(SettingRow, {
            title: '停靠位置',
            desc: '缩略图贴在对话内容的哪一侧',
          },
            h(SettingSegment, {
              value: s.side,
              label: '停靠位置',
              options: [
                { value: 'right', label: '右侧' },
                { value: 'left', label: '左侧' },
              ],
              onChange: (v) => updateSettings({ side: v }),
            })),
          h(SettingRow, {
            title: '隐藏系统消息导航条',
            desc: '关闭会话右侧原有的消息导航条（如果已安装），避免与缩略图争夺同一条边缘',
          },
            h(SettingToggle, {
              value: s.hideRail,
              label: '隐藏系统消息导航条',
              onChange: (v) => updateSettings({ hideRail: v }),
            })),
          h(SettingRow, {
            title: '隐藏右下角齿轮按钮',
            desc: 'Markdown 插件（dsh-md-plus）在右下角有一个悬浮设置齿轮，正好压在缩略图上；默认隐藏',
          },
            h(SettingToggle, {
              value: s.hideRailGear,
              label: '隐藏右下角齿轮按钮',
              onChange: (v) => updateSettings({ hideRailGear: v }),
            })),
          h(SettingRow, { title: '显示当前位置框', desc: '关闭后只显示内容，不显示阅读位置' },
            h(SettingToggle, {
              value: s.showViewport,
              label: '显示当前位置框',
              onChange: (v) => updateSettings({ showViewport: v }),
            })),
          h(SettingRow, { title: '窄窗口自动隐藏', desc: '内容列太窄时收起地图，避免遮挡' },
            h(SettingToggle, {
              value: s.hideOnNarrow,
              label: '窄窗口自动隐藏',
              onChange: (v) => updateSettings({ hideOnNarrow: v }),
            })),
          h(SettingRow, { title: '隐藏阈值', desc: '内容列窄于该宽度时隐藏（px）' },
            h(SettingSlider, {
              value: s.minColumn, min: 320, max: 1600, step: 20,
              label: '隐藏阈值', format: (v) => v + 'px',
              onChange: (v) => updateSettings({ minColumn: v }),
            }))),

        h('div', { className: 'cgSetFoot' },
          h('button', {
            type: 'button',
            className: 'cgSetReset',
            onClick: () => resetSettings(),
          }, '恢复默认'),
          h('span', { className: 'cgSetDesc' }, '设置保存在本机，重装插件不会丢失')),
      );
    }

    /* ---------------------------------------------------------------- *
     * Plugin
     * ---------------------------------------------------------------- */

    return {
      inject: ['slots'],
      apply(ctx) {
        // The stylesheet is generated from settings, so it is rebuilt when
        // a colour or size changes: one tag, rewritten in place.
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = 'dsh-codeglance';
          document.head.appendChild(tag);
          const applyCss = () => {
            tag.textContent = buildCss(settingsSnapshot());
          };
          applyCss();
          const unsubscribe = subscribeSettings(applyCss);
          return () => {
            unsubscribe();
            tag.remove();
          };
        }, 'codeglance:styles');

        // Hide foreign floating controls that overlap this map.
        //
        // Two of them sit in the same bottom-right corner:
        //   .crl_nav              the conversation rail (dsh-chat-rail)
        //   .md-plus-settings-btn dsh-md-plus's gear, fixed at
        //                         right:16px bottom:76px z-index 2147482000
        //
        // Both belong to other bundles, so the only safe lever is a
        // stylesheet rule of our own — never their DOM.
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = 'dsh-codeglance-rail';
          document.head.appendChild(tag);
          const apply = () => {
            const s = settingsSnapshot();
            const rules = [];
            if (s.hideRail) rules.push('.crl_nav{display:none !important}');
            if (s.hideRailGear) rules.push('.md-plus-settings-btn{display:none !important}');
            tag.textContent = rules.join('\n');
          };
          apply();
          const unsubscribe = subscribeSettings(apply);
          return () => {
            unsubscribe();
            tag.remove();
          };
        }, 'codeglance:rail');

        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'codeglance',
          order: 60,
        }, Minimap));

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'codeglance',
          order: 44,
          label: () => '会话缩略图',
        }, SettingsPage));
      },
    };
  },
});
