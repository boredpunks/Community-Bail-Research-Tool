"""Public-label discovery; native binding proof stays in memory, never submitted."""
import asyncio
import json
import time
from calendar_protocol import select_calendar_preview_controls, wait_for_calendar_search_button, calendar_form_field_count

METHOD = "playwright-public-courtroom-observation-v2"
LOCAL_TIMEOUT_SECONDS = 15
STABLE_SECONDS = 0.5

# Field names/IDs and option values are used ephemerally for association/readback.
# None are returned. No private widget APIs, source text, HTML or tokens emitted.
PROBE = r"""({select506, includeSubmissionField}) => {
  const buttons = [...document.querySelectorAll("#btnSearch")];
  const form = buttons.length === 1 ? buttons[0].form : null;
  if (!form) return {error: "COURTROOM_OBSERVATION_FORM_MISSING"};
  const action = new URL(buttons[0].getAttribute("formaction") || form.action, document.baseURI);
  if (action.href !== "https://ujsportal.pacourts.us/CaseSearch"
      || (buttons[0].getAttribute("formmethod") || form.method).toLowerCase() !== "post"
      || (buttons[0].getAttribute("formenctype") || form.enctype).toLowerCase()
        !== "application/x-www-form-urlencoded")
    return {error: "UNSUPPORTED_CALENDAR_FORM_TARGET"};
  const ownedLabels = [...document.querySelectorAll("label")].filter(label =>
    form.contains(label) || label.control?.form === form);
  if (form.elements.length > 256 || ownedLabels.length > 128)
    return {error: "COURTROOM_OBSERVATION_LIMIT"};
  const normalize = text => text.trim().replace(/\s+/g, " ");
  const roomLabel = text => /^(?:court\s*room|room)(?:\s*(?:number|no\.?))?\s*:?\s*$/i.test(normalize(text));
  const safeLabel = node => {
    const text = node?.textContent || "";
    return text.length <= 128 && roomLabel(text);
  };
  const all = [...form.elements];
  const labels = ownedLabels.filter(safeLabel);
  const candidates = new Map();
  for (const label of labels) {
    let select = label.control?.tagName === "SELECT" ? label.control : null;
    let group = label.parentElement;
    if (!select) {
      for (let depth = 0; group && group !== form && depth < 8; depth++, group = group.parentElement) {
        const selects = [...group.querySelectorAll("select")];
        // Do not bind an unrelated control by climbing across other public labels.
        if (group.querySelectorAll("label").length > 1) break;
        if (selects.length > 1) break;
        if (selects.length === 1) { select = selects[0]; break; }
      }
    }
    if (select) candidates.set(select, group && group !== form ? group : select.parentElement);
  }
  for (const select of all.filter(el => el.tagName === "SELECT")) {
    const aria = select.getAttribute("aria-label");
    const ids = (select.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    if (ids.length > 8) return {error: "COURTROOM_OBSERVATION_LIMIT"};
    if (aria && aria.length <= 128 && roomLabel(aria)
        || ids.some(id => safeLabel(document.getElementById(id)))) {
      if (!candidates.has(select)) candidates.set(select, select.parentElement);
    }
  }
  const observedLabels = Math.max(labels.length, candidates.size);
  const snapshot = {labels: Math.min(observedLabels, 2), controls: Math.min(candidates.size, 2),
    enabled: false, sameForm: false,
    busy: !!form.querySelector('[aria-busy="true"],[role="progressbar"]'),
    options: 0, room506Options: 0, room506Enabled: false, room506Selected: false,
    namedBindings: 0, nativeMatches: false};
  if (observedLabels !== 1 || candidates.size !== 1) return snapshot;
  const [select, group] = [...candidates][0];
  if (select.options.length > 512) return {error: "COURTROOM_OBSERVATION_LIMIT"};
  snapshot.options = select.options.length;
  snapshot.enabled = !select.matches(":disabled");
  snapshot.sameForm = select.form === form;
  const matches = [...select.options].filter(option =>
    normalize(option.label).replace(/^court\s*room\s*/i, "") === "506");
  snapshot.room506Options = Math.min(matches.length, 2);
  snapshot.room506Enabled = matches.length === 1 && !matches[0].disabled
    && !matches[0].closest("optgroup")?.disabled;
  if (select506 && snapshot.enabled && snapshot.sameForm && snapshot.room506Enabled) {
    select.value = matches[0].value;
    select.dispatchEvent(new Event("input", {bubbles: true}));
    select.dispatchEvent(new Event("change", {bubbles: true}));
    // A dependency may replace the widget; the caller re-discovers it afresh.
    return snapshot;
  }
  snapshot.room506Selected = matches.length === 1 && select.selectedOptions.length === 1
    && select.selectedOptions[0] === matches[0];
  const secret = /token|password|secret|session|cookie|captcha|verification|auth/i;
  const backing = select.name ? [select] : group
    ? [...group.querySelectorAll("input[name],select[name]")].filter(el =>
      el !== select && ["hidden", "text", "number"].includes(el.type)
      && el.form === form && !el.matches(":disabled") && !secret.test(el.name + el.id))
    : [];
  if (backing.length > 32) return {error: "COURTROOM_OBSERVATION_LIMIT"};
  snapshot.namedBindings = backing.length;
  if (backing.length === 1 && backing[0].form === form && !backing[0].matches(":disabled")
      && !secret.test(backing[0].name + backing[0].id)) {
    const entries = new FormData(form).getAll(backing[0].name);
    snapshot.nativeMatches = entries.length === 1 && entries[0] === select.value
      && backing[0].value === select.value;
    if (includeSubmissionField && snapshot.nativeMatches)
      snapshot.submittedBinding = {name: backing[0].name, value: entries[0]};
  }
  return snapshot;
}"""


async def observe(page, emit, criteria, is_clean=lambda: True):
    async def probe(select=False):
        value = await page.evaluate(PROBE, {"select506": select})
        if isinstance(value, dict) and value.get("error") in {
                "COURTROOM_OBSERVATION_FORM_MISSING", "COURTROOM_OBSERVATION_LIMIT",
                "UNSUPPORTED_CALENDAR_FORM_TARGET"}:
            raise RuntimeError(value["error"])
        return value

    await wait_for_calendar_search_button(page)
    initial = await probe()
    # Preserve the user's intended room, but discover it separately from public
    # labels. Never pass it into the legacy assumed-field-name selector.
    public_criteria = {key: value for key, value in criteria.items() if key != "courtRoom"}
    await select_calendar_preview_controls(page, public_criteria)
    deadline = time.monotonic() + LOCAL_TIMEOUT_SECONDS
    started = time.monotonic()
    after_criteria = None
    after_selection = None
    selected = False
    previous = None
    stable_since = time.monotonic()
    stable = False
    while True:
        if not is_clean():
            raise RuntimeError("COVERAGE_UNEXPECTED_LOCAL_REQUEST")
        current = await probe()
        fingerprint = json.dumps(current, sort_keys=True)
        if fingerprint != previous:
            stable_since = time.monotonic()
            previous = fingerprint
        stable = time.monotonic() - stable_since >= STABLE_SECONDS
        if not selected:
            after_criteria = current
            if (current["labels"] == 1 and current["controls"] == 1
                    and current["enabled"] and current["sameForm"]
                    and not current["busy"] and current["room506Enabled"]
                    and current["room506Options"] == 1 and stable):
                await probe(True)
                selected = True
                previous = None
                continue
        else:
            after_selection = current
            if (current["room506Selected"] and current["nativeMatches"]
                    and current["namedBindings"] == 1 and not current["busy"] and stable):
                break
        if time.monotonic() >= deadline:
            break
        await asyncio.sleep(0.05)
    final = after_selection or after_criteria
    if final["labels"] > 1 or final["controls"] > 1 or final["room506Options"] > 1:
        outcome = "AMBIGUOUS_PUBLIC_CONTROL"
    elif final["labels"] == 0:
        outcome = "CONTROL_NOT_EXPOSED"
    elif final["controls"] == 0:
        outcome = "ASSOCIATION_UNPROVEN"
    elif final["busy"] or not final["enabled"] or not final["options"]:
        outcome = "DEPENDENCY_UNRESOLVED"
    elif final["room506Options"] != 1 or not final["room506Enabled"]:
        outcome = "ROOM_506_UNAVAILABLE"
    elif (selected and final["room506Selected"] and final["nativeMatches"]
          and final["namedBindings"] == 1 and final["sameForm"] and stable):
        outcome = "BOUND_506"
    else:
        outcome = "BINDING_UNPROVEN"
    if not is_clean():
        raise RuntimeError("COVERAGE_UNEXPECTED_LOCAL_REQUEST")
    await calendar_form_field_count(page)
    emit("courtroom_metadata", phase="OBSERVED", initial=initial, afterCriteria=after_criteria,
         afterSelection=after_selection, outcome=outcome,
         waitMs=min(15_000, int((time.monotonic() - started) * 1000)), stable=stable)
