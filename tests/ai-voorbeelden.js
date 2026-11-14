// Nagebootste antwoorden van de Anthropic API voor tests/ai.test.js en de rooktest (geen echte API-aanroepen).

/** Bericht zoals de SDK het na finalMessage() teruggeeft. */
export function bericht(json, { stop = 'end_turn', model = 'claude-opus-5-5', usage = null, extra = [] } = {}) {
  return {
    id: 'msg_test', type: 'message', role: 'assistant', model,
    content: [{ type: 'thinking', thinking: '', signature: 'sig' }, ...extra, ...(json == null ? [] : [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }])],
    stop_reason: stop, stop_sequence: null,
    usage: usage || { input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 6000, cache_creation_input_tokens: 0 },
  };
}

/** SSE-stroom (text/event-stream) voor een bericht, zoals de Messages API ze stuurt. */
export function sse(b, { stukken = 3 } = {}) {
  const ev = [];
  const push = (type, data) => ev.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  push('message_start', { message: { ...b, content: [], stop_reason: null, usage: { ...b.usage, output_tokens: 1 } } });
  b.content.forEach((blok, index) => {
    if (blok.type === 'text') {
      push('content_block_start', { index, content_block: { type: 'text', text: '' } });
      const n = Math.max(1, Math.ceil(blok.text.length / stukken));
      for (let i = 0; i < blok.text.length; i += n) push('content_block_delta', { index, delta: { type: 'text_delta', text: blok.text.slice(i, i + n) } });
    } else if (blok.type === 'thinking') {
      push('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      push('content_block_delta', { index, delta: { type: 'signature_delta', signature: blok.signature } });
    } else {
      push('content_block_start', { index, content_block: blok });
    }
    push('content_block_stop', { index });
  });
  push('message_delta', { delta: { stop_reason: b.stop_reason, stop_sequence: null }, usage: { output_tokens: b.usage.output_tokens } });
  push('message_stop', {});
  return ev.join('');
}

// ---------------------------------------------------------------- antwoorden op het ontwerp "voorbeeld"

/** Eén geldige variant op designs/voorbeeld.json: een nieuwe binnenmuur + deur (ids volgen uit het ontwerp). */
export function geldigeVariant(model, { naam = 'Extra binnenmuur', dx = 0 } = {}) {
  const n0 = model.niveaus[0].id;
  const xs = model.muren.filter((m) => m.niveau === n0).flatMap((m) => [m.start[0], m.eind[0]]);
  const ys = model.muren.filter((m) => m.niveau === n0).flatMap((m) => [m.start[1], m.eind[1]]);
  const x = Math.round((Math.min(...xs) + Math.max(...xs)) / 2) + dx;
  return {
    naam,
    beschrijving: `Nieuwe binnenmuur op x = ${x} mm met een binnendeur.`,
    ops: [
      { op: 'toevoegen', collectie: 'muren', item: { id: 'M900', niveau: n0, start: [x, Math.min(...ys)], eind: [x, Math.min(...ys) + 3000], dikte: 100, status: 'nieuw' } },
      { op: 'toevoegen', collectie: 'openingen', item: { id: 'O900', muur: 'M900', type: 'deur', positie: 1000, breedte: 900, hoogte: 2100, borstwering: 0, status: 'nieuw' } },
    ],
  };
}

/** Ongeldige variant: verwijst naar een onbestaande muur. */
export function ongeldigeVariant() {
  return {
    naam: 'Fout',
    beschrijving: 'Opening in een muur die niet bestaat.',
    ops: [{ op: 'toevoegen', collectie: 'openingen', item: { id: 'O901', muur: 'M999', type: 'raam', positie: 100, breedte: 900, hoogte: 1200, borstwering: 900, status: 'nieuw' } }],
  };
}

// ---------------------------------------------------------------- programma van eisen op "bestaand"

export const OPDRACHT_PVE = 'Breek de achterbouw en garage 2 af (afbraak) en maak een compact plan volgens een programma van eisen: draaitrap naar zolder + 2 slaapkamers + kleine berging + kleine badkamer (lavabo + douche) onder het dak.';

/**
 * Nagebootst antwoord op OPDRACHT_PVE voor designs/bestaand.json: afbraak van de achterbouw (muren M3/M12/M13 met hun
 * openingen, plat dak D2, doorgang O12) en van garage 2 (M27–M29, O30, vloer V4, dak D4), ruimtes van die delen weg,
 * nieuw zolderniveau N2 op de bovenkant van de verdieping met een draaitrap, 2 slaapkamers, berging en badkamer.
 */
export function antwoordPve() {
  const afbraak = (collectie, id) => ({ op: 'wijzigen', collectie, id, velden: { status: 'afbraak' } });
  const ruimte = (id, naam, functie, [x0, y0, x1, y1]) => ({ op: 'toevoegen', collectie: 'ruimtes', item: { id, niveau: 'N2', naam, functie, contour: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] } });
  const muur = (id, s, e, dikte = 100) => ({ op: 'toevoegen', collectie: 'muren', item: { id, niveau: 'N2', start: s, eind: e, dikte, status: 'nieuw' } });
  return {
    samenvatting: 'Achterbouw en garage 2 op afbraak gezet; nieuw zolderniveau met draaitrap, 2 slaapkamers, berging en badkamer. Aanname: slaapkamers ±10 m², badkamer 2,4 × 2,0 m, berging 1,6 m², draaitrap Ø 1,6 m. Niet modelleerbaar in schema v1: de draaitrap zelf, schuine plafonds/vrije hoogte onder het zadeldak en het sanitair (lavabo + douche) — als ruimtes benoemd.',
    vragen: [],
    varianten: [{
      naam: 'Compacte zolder',
      beschrijving: 'Afbraak achterbouw (M3, M12, M13 en hun deuren/ramen, plat dak D2, doorgang O12) en garage 2 (M27–M29, O30, vloer V4, dak D4). Zolder N2 op peil 5800 mm, hoogte 2400 mm, met lichte binnenwanden van 100 mm.',
      ops: [
        ...['M3', 'M12', 'M13', 'M27', 'M28', 'M29'].map((id) => afbraak('muren', id)),
        ...['O9', 'O10', 'O11', 'O12', 'O17', 'O18', 'O30'].map((id) => afbraak('openingen', id)),
        afbraak('daken', 'D2'), afbraak('daken', 'D4'), afbraak('vloeren', 'V4'),
        ...['R5', 'R6', 'R7', 'R15'].map((id) => ({ op: 'verwijderen', collectie: 'ruimtes', id })),
        { op: 'toevoegen', collectie: 'niveaus', item: { id: 'N2', naam: 'Zolder', peil: 5800, hoogte: 2400, vloerdikte: 250 } },
        { op: 'toevoegen', collectie: 'vloeren', item: { id: 'V5', niveau: 'N2', contour: [[0, 0], [7070, 0], [7070, 8000], [0, 8000]], dikte: 250, status: 'nieuw' } },
        muur('M30', [2790, 140], [2790, 7860]),
        muur('M31', [140, 2000], [2790, 2000]),
        muur('M32', [2790, 4000], [6930, 4000]),
        muur('M33', [140, 5900], [2790, 5900]),
        ruimte('R16', 'Trap (draaitrap Ø 1,6 m)', 'trap', [280, 280, 2740, 1950]),
        ruimte('R17', 'Berging', 'berging', [280, 2050, 2740, 2700]),
        ruimte('R18', 'Badkamer (lavabo + douche)', 'badkamer', [280, 3500, 2740, 5850]),
        ruimte('R19', 'Slaapkamer 1', 'slaapkamer', [2840, 280, 6860, 3950]),
        ruimte('R20', 'Slaapkamer 2', 'slaapkamer', [2840, 4050, 6860, 7720]),
        ruimte('R21', 'Overloop', 'hal', [280, 2750, 2740, 3450]),
        { op: 'toevoegen', collectie: 'openingen', item: { id: 'O31', muur: 'M30', type: 'deur', positie: 1200, breedte: 830, hoogte: 2015, borstwering: 0, status: 'nieuw' } },
        { op: 'toevoegen', collectie: 'openingen', item: { id: 'O32', muur: 'M30', type: 'deur', positie: 4300, breedte: 830, hoogte: 2015, borstwering: 0, status: 'nieuw' } },
      ],
    }],
  };
}
