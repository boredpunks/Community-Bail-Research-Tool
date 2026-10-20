"""Public-label discovery; native binding proof stays in memory, never submitted."""
import asyncio
import json
import time
from calendar_protocol import select_calendar_preview_controls, wait_for_calendar_search_button, calendar_form_field_count
from room_discovery import PUBLIC_ROOM_HELPERS

METHOD = "playwright-public-courtroom-observation-v2"
LOCAL_TIMEOUT_SECONDS = 15
STABLE_SECONDS = 0.5

# Field names/IDs and option values are used ephemerally for association/readback.
# None are returned. No private widget APIs, source text, HTML or tokens emitted.
PROBE = "({select506, includeSubmissionField}) => {" + PUBLIC_ROOM_HELPERS + r"""
  const buttons = [...document.querySelectorAll("#btnSearch")];
  const form = buttons.length === 1 ? buttons[0].form : null;
  if (!form) return {error: "COURTROOM_OBSERVATION_FORM_MISSING"};
  const action = new URL(buttons[0].getAttribute("formaction") || form.action, document.baseURI);
  if (action.href !== "https://ujsportal.pacourts.us/CaseSearch"
      || (buttons[0].getAttribute("formmethod") || form.method).toLowerCase() !== "post"
      || (buttons[0].getAttribute("formenctype") || form.enctype).toLowerCase()
        !== "application/x-www-form-urlencoded")
    return {error: "UNSUPPORTED_CALENDAR_FORM_TARGET"};
  const normalize = text => text.trim().replace(/\s+/g, " ");
  const discovered = discoverPublicRoom(form);
  if (discovered.limit) return {error: "COURTROOM_OBSERVATION_LIMIT"};
  const snapshot = {labels: Math.min(discovered.labels, 2), controls: Math.min(discovered.controls, 2),
    enabled: false, sameForm: false,
    busy: !!form.querySelector('[aria-busy="true"],[role="progressbar"]'),
    options: 0, room506Options: 0, room506Enabled: false, room506Selected: false,
    namedBindings: 0, nativeMatches: false};
  if (discovered.labels !== 1 || discovered.controls !== 1 || !discovered.select) return snapshot;
  const {select, group} = discovered;
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
  const binding = publicRoomBinding(form, select, group);
  if (binding.count > 32) return {error: "COURTROOM_OBSERVATION_LIMIT"};
  snapshot.namedBindings = binding.count;
  snapshot.nativeMatches = !binding.reason && snapshot.sameForm;
  if (includeSubmissionField && snapshot.nativeMatches)
    snapshot.submittedBinding = {name: binding.name, value: binding.value};
  return snapshot;
}"""


async def observe(page, emit, criteria, is_clean=lambda: True, controls_prevalidated=False):
    async def probe(select=False):
        value = await page.evaluate(PROBE, {"select506": select})
        if isinstance(value, dict) and value.get("error") in {
                "COURTROOM_OBSERVATION_FORM_MISSING", "COURTROOM_OBSERVATION_LIMIT",
                "UNSUPPORTED_CALENDAR_FORM_TARGET"}:
            raise RuntimeError(value["error"])
        return value

    await wait_for_calendar_search_button(page)
    initial = await probe()
    if not controls_prevalidated:
        # Preserve the user's intended room, but discover it separately from public
        # labels. Never pass it into the legacy assumed-field-name selector.
        public_criteria = {key: value for key, value in criteria.items() if key != "courtRoom"}
        await select_calendar_preview_controls(page, public_criteria)
    deadline = time.monotonic() + LOCAL_TIMEOUT_SECONDS
    started = time.monotonic()
    after_criteria = initial if controls_prevalidated else None
    after_selection = None
    selected = controls_prevalidated
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
    metadata = {"kind": "courtroom_metadata", "phase": "OBSERVED", "initial": initial,
                "afterCriteria": after_criteria, "afterSelection": after_selection, "outcome": outcome,
                "waitMs": min(15_000, int((time.monotonic() - started) * 1000)), "stable": stable}
    emit("courtroom_metadata", **{key: value for key, value in metadata.items() if key != "kind"})
    return metadata
