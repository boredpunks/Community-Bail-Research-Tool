"""Public-title binding observed in the portal on 2026-10-18.

Visible native selects are unnamed. Their model inputs, not labels' for
attributes, carry the successful form values. No selection or networking here.
"""

PUBLIC_ROOM_HELPERS = r"""
const discoverPublicSelect = (form, title) => {
  if (form.elements.length > 256) return {limit: true};
  const controls = [...form.querySelectorAll("select")].filter(el => el.title === title);
  const result = {labels: controls.length, controls: controls.length};
  if (controls.length !== 1) return {...result,
    reason: controls.length ? "CONTROL_AMBIGUOUS" : "MISSING"};
  const select = controls[0];
  if (select.options.length > 512) return {limit: true};
  return {...result, select, reason: select.form !== form ? "WRONG_FORM" : null};
};
const discoverPublicRoom = form => discoverPublicSelect(form, "Room");
const publicSelectBinding = (form, select, hiddenName) => {
  const fields = select.name ? [select]
    : [...form.querySelectorAll("input")].filter(el => el.name === hiddenName);
  if (fields.length !== 1) return {count: Math.min(fields.length, 33),
    reason: fields.length ? "BACKING_CONTROL_AMBIGUOUS" : "BACKING_CONTROL_MISSING"};
  const field = fields[0];
  if (field.form !== form) return {count: 1, reason: "WRONG_FORM"};
  if (field.matches(":disabled")) return {count: 1, reason: "DISABLED"};
  if (field !== select && !["hidden", "text"].includes(field.type))
    return {count: 1, reason: "BACKING_CONTROL_MISSING"};
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(field.name)
      || /token|password|secret|session|cookie|captcha|verification|auth/i.test(field.name + field.id))
    return {count: 1, reason: "UNNAMED"};
  const entries = new FormData(form).getAll(field.name);
  if (!entries.length) return {count: 1, reason: "SUBMITTED_FIELD_MISSING"};
  if (entries.length !== 1 || entries[0] !== select.value || field.value !== select.value)
    return {count: 1, reason: "BACKING_VALUE_MISMATCH"};
  return {count: 1, name: field.name, value: entries[0]};
};
const publicRoomBinding = (form, select) => publicSelectBinding(form, select, "CourtRoomID");
"""
