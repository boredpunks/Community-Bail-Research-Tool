"""Shared public-room association and native binding; no selection or networking.

JavaScript helpers return DOM references only within the caller's evaluation.
They must not be emitted as inspection metadata.
"""

PUBLIC_ROOM_HELPERS = r"""
const discoverPublicRoom = form => {
  const allLabels = [...document.querySelectorAll("label")];
  const all = [...form.elements];
  if (all.length > 256 || allLabels.length > 256) return {limit: true};
  const normalize = text => text.trim().replace(/\s+/g, " ");
  const roomLabel = text => text.length <= 128
    && /^(?:court\s*room|room)(?:\s*(?:number|no\.?))?\s*:?\s*$/i.test(normalize(text));
  const safeLabel = node => {
    if (!node) return false;
    // Wrapped native controls contribute option text to textContent; that is
    // not the public label. Do not let option values determine its identity.
    const copy = node.cloneNode(true);
    for (const control of copy.querySelectorAll("select,input,textarea,button")) control.remove();
    return roomLabel(copy.textContent || "");
  };
  const labels = allLabels.filter(label => safeLabel(label)
    && (form.contains(label) || label.control?.form === form));
  const candidates = new Map();
  let ambiguous = false;
  // A backing field must be in a bounded, dedicated public widget group.
  const dedicatedGroup = select => {
    const group = select.parentElement;
    return group && group !== form && group.querySelectorAll("label").length <= 1
      && group.querySelectorAll("select").length === 1 ? group : null;
  };
  for (const label of labels) {
    let select = label.control?.tagName === "SELECT" ? label.control : null;
    let group = select ? dedicatedGroup(select) : label.parentElement;
    // An explicit association with another kind of control is not permission
    // to replace it with a nearby select.
    if (!label.control) {
      for (let depth = 0; group && group !== form && depth < 8; depth++, group = group.parentElement) {
        if (group.tagName === "FORM" || group.querySelectorAll("label").length > 1) break;
        const selects = [...group.querySelectorAll("select")];
        if (selects.length > 1) { ambiguous = true; break; }
        if (selects.length === 1) { select = selects[0]; break; }
      }
    }
    if (select) candidates.set(select, group);
  }
  for (const select of all.filter(el => el.tagName === "SELECT")) {
    const aria = select.getAttribute("aria-label");
    const ids = (select.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    if (ids.length > 8) return {limit: true};
    if (aria && roomLabel(aria) || ids.some(id => safeLabel(document.getElementById(id)))) {
      if (!candidates.has(select)) candidates.set(select, dedicatedGroup(select));
    }
  }
  const labelCount = Math.max(labels.length, candidates.size);
  const controlCount = ambiguous ? Math.max(2, candidates.size) : candidates.size;
  const result = {labels: labelCount, controls: controlCount};
  if (labelCount > 1 || controlCount > 1) return {...result, reason: "CONTROL_AMBIGUOUS"};
  if (!labelCount) return {...result, reason: "MISSING"};
  if (!controlCount) return {...result, reason: "ASSOCIATION_UNPROVEN"};
  const [select, group] = [...candidates][0];
  if (select.options.length > 512) return {limit: true};
  return {...result, select, group,
    reason: select.form !== form ? "WRONG_FORM" : null};
};

const publicRoomBinding = (form, select, group) => {
  const secret = /token|password|secret|session|cookie|captcha|verification|auth/i;
  // Do not filter wrong-form/disabled/secret candidates out before checking
  // uniqueness: doing so could silently choose a different backing field.
  const backing = select.name ? [select] : group
    ? [...group.querySelectorAll("input[name],select[name]")].filter(el => el !== select)
    : [];
  if (backing.length !== 1) return {count: Math.min(backing.length, 33),
    reason: backing.length ? "BACKING_CONTROL_AMBIGUOUS" : "BACKING_CONTROL_MISSING"};
  const field = backing[0];
  if (field.form !== form) return {count: 1, reason: "WRONG_FORM"};
  if (field.matches(":disabled")) return {count: 1, reason: "DISABLED"};
  if (field !== select && (field.tagName !== "INPUT"
      || !["hidden", "text", "number"].includes(field.type)))
    return {count: 1, reason: "BACKING_CONTROL_MISSING"};
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(field.name)
      || secret.test(field.name + field.id)) return {count: 1, reason: "UNNAMED"};
  const entries = new FormData(form).getAll(field.name);
  if (!entries.length) return {count: 1, reason: "SUBMITTED_FIELD_MISSING"};
  if (entries.length !== 1 || entries[0] !== select.value || field.value !== select.value)
    return {count: 1, reason: "BACKING_VALUE_MISMATCH"};
  return {count: 1, name: field.name, value: entries[0]};
};
"""
