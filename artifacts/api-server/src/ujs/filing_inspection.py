"""Source-labeled filing controls only; never Search, dates, HTML or field values."""
from coverage_inspection import SELECT_MODE

METHOD = "playwright-filing-form-inspection-v1"

# This is recognition vocabulary, NOT a claim about the portal's labels/layout.
# Values/field names and candidate DOM associations stay in child memory.
STATE = """({phase, selectRole}) => {
  const form = document.querySelector('#btnSearch')?.form;
  if (!form) return {error: 'FILING_FORM_MISSING'};
  const roles = {
    SEARCH_MODE: ['Search By', 'Search by'],
    COURT_TYPE: ['Court Type', 'Court type'],
    COUNTY: ['County'],
    CASE_TYPE: ['Case Type', 'Case type', 'Case Category'],
    COURT_OFFICE: ['Court Office', 'Court office']
  };
  const choices = {
    SEARCH_MODE: ['Date Filed', 'Filing Date', 'Date of Filing'],
    COURT_TYPE: ['Magisterial District Court', 'Magisterial District Courts', 'Magisterial District', 'MDJ'],
    COUNTY: ['Allegheny'],
    CASE_TYPE: ['Criminal'],
    COURT_OFFICE: []
  };
  const sensitive = /token|password|secret|session|cookie|captcha|verification|auth|birth|dob|defendant|participant|attorney|judge|docket|name|address|email|phone|ssn/i;
  const all = [...document.querySelectorAll('select')];
  if (all.length > 64 || form.elements.length > 512) return {error: 'FILING_CONTROL_INVALID'};
  const visible = node => !!node && !!node.getClientRects().length;
  const eligible = node => node && node.form === form && !node.matches(':disabled') && visible(node);
  const groupOf = node => {
    for (let p = node.parentElement, n = 0; p && p !== form && n < 4; p = p.parentElement, n++)
      if (p.id.endsWith('-Control') && p.querySelectorAll('select').length === 1) return p;
    return null;
  };
  const labels = node => {
    const group = groupOf(node);
    const ids = new Set([node.id, group?.id.slice(0, -8)].filter(Boolean));
    const result = [...(node.labels || [])].map(label => label.textContent);
    result.push(node.getAttribute('aria-label') || '');
    for (const id of (node.getAttribute('aria-labelledby') || '').split(/\\s+/).slice(0, 8))
      if (id) result.push(document.getElementById(id)?.textContent || '');
    for (const label of document.querySelectorAll('label'))
      if (ids.has(label.htmlFor) || group?.contains(label)) result.push(label.textContent);
    return result.map(text => text.trim().replace(/[:*]\\s*$/, '').trim());
  };
  const matches = Object.fromEntries(Object.keys(roles).map(role => [role, []]));
  let unclassifiedSelects = 0;
  for (const node of all) {
    if (node.form !== form || sensitive.test(node.name + ' ' + node.id)) continue;
    const knownMode = node.parentElement?.id === 'SearchBy-Control'
      || document.querySelector('#SearchBy-Control select') === node;
    const text = labels(node);
    const found = Object.keys(roles).filter(role => role === 'SEARCH_MODE' ? knownMode
      : roles[role].some(label => text.includes(label)));
    if (found.length > 1) return {error: 'FILING_CONTROL_AMBIGUOUS'};
    if (found.length) matches[found[0]].push(node); else unclassifiedSelects++;
  }
  if (selectRole) {
    const nodes = matches[selectRole];
    if (!nodes) return {error: 'FILING_CONTROL_INVALID'};
    if (nodes.length > 1) return {error: 'FILING_CONTROL_AMBIGUOUS'};
    const node = nodes[0];
    if (!eligible(node)) return {index: null, value: null};
    if (node.options.length > 2000) return {error: 'FILING_CONTROL_INVALID'};
    const options = [...node.options].filter(option => !option.disabled
      && choices[selectRole].includes(option.textContent.trim()));
    if (options.length > 1) return {error: 'FILING_CONTROL_AMBIGUOUS'};
    return {index: options.length === 1 ? all.indexOf(node) : null,
      value: options.length === 1 ? options[0].value : null};
  }
  const data = new FormData(form), controls = [];
  for (const role of Object.keys(roles)) {
    const nodes = matches[role], node = nodes.length === 1 ? nodes[0] : null;
    const optionCount = node?.options.length || 0;
    if (optionCount > 2000) return {error: 'FILING_CONTROL_INVALID'};
    const choicePresent = eligible(node) && [...node.options].some(option => !option.disabled
      && choices[role].includes(option.textContent.trim()));
    const selectedChoiceMatches = eligible(node) && [...node.selectedOptions].some(option =>
      !option.disabled && choices[role].includes(option.textContent.trim()));
    const group = node && groupOf(node);
    const candidates = new Set(node ? [node] : []);
    if (group) {
      for (const field of group.querySelectorAll('input,select,textarea')) candidates.add(field);
      // A public DOM-group suffix is a candidate relationship, never binding proof.
      const related = document.getElementById(group.id.slice(0, -8));
      if (related) candidates.add(related);
    }
    if (candidates.size > 32) return {error: 'FILING_CONTROL_INVALID'};
    let nativeNamed = 0, nativeMatches = 0;
    for (const field of candidates) {
      if (!field.name || field.name.length > 128 || sensitive.test(field.name + ' ' + field.id)
        || field.form !== form || field.matches(':disabled')
        || !['hidden','text','date','number','select-one','textarea'].includes(field.type)) continue;
      nativeNamed++;
      const values = data.getAll(field.name);
      if (node && node.value !== '' && values.length === 1 && values[0] === node.value) nativeMatches++;
    }
    controls.push({role, candidates: nodes.length, visible: visible(node),
      enabled: !!node && !node.matches(':disabled'), optionCount,
      choicePresent: !!choicePresent, selectedChoiceMatches: !!selectedChoiceMatches,
      nativeNamed, nativeMatches, association: group ? 'DOM_GROUP' : node?.labels.length ? 'DIRECT_LABEL' : 'NONE'});
  }
  const scopeReady = ['COURT_TYPE','COUNTY','CASE_TYPE'].every(role =>
    controls.find(row => row.role === role).selectedChoiceMatches);
  const modeMatchesFiling = controls[0].selectedChoiceMatches;
  const office = matches.COURT_OFFICE.length === 1 ? matches.COURT_OFFICE[0] : null;
  const officeCodes = scopeReady && modeMatchesFiling && eligible(office)
    ? [...office.options].filter(option => !option.disabled).map(option => option.value)
      .filter(value => /^(?:MDJ|MJ)-05(?:-[A-Za-z0-9]{1,20}){1,4}$/.test(value)) : [];
  if (officeCodes.length > 250 || new Set(officeCodes).size !== officeCodes.length)
    return {error: 'FILING_CONTROL_INVALID'};
  const dates = [];
  for (const node of form.querySelectorAll('input[type=date]')) {
    const identity = node.name + ' ' + node.id;
    if (sensitive.test(identity) || !/filed|filing/i.test(identity)) continue;
    const bound = value => value === '' ? null : /^\\d{4}-\\d{2}-\\d{2}$/.test(value) ? value : 'INVALID';
    dates.push({minimum: bound(node.min), maximum: bound(node.max),
      visible: visible(node), enabled: !node.matches(':disabled'),
      nativeNamed: !!node.name, nativeSuccessful: !!node.name && !node.matches(':disabled')
        && node.form === form && data.getAll(node.name).length === 1});
  }
  if (dates.length > 16 || dates.some(row => row.minimum === 'INVALID' || row.maximum === 'INVALID'))
    return {error: 'FILING_CONTROL_INVALID'};
  return {phase, controls, scopeReady: scopeReady && modeMatchesFiling,
    modeMatchesFiling, officeCodes, dates, unclassifiedSelects};
}"""


async def observe(page, emit):
    choice = await page.evaluate(SELECT_MODE, {"labels": ["Date Filed", "Filing Date", "Date of Filing"]})
    if not isinstance(choice, dict) or "error" in choice or choice.get("value") is None:
        raise RuntimeError("FILING_MODE_NOT_ESTABLISHED")
    await page.locator("#SearchBy-Control select").select_option(choice["value"])
    for phase, role in (("FILING", None), ("COURT_TYPE", "COURT_TYPE"), ("COUNTY", "COUNTY"),
                        ("CASE_TYPE", "CASE_TYPE"), ("FINAL", None)):
        if role:
            selection = await page.evaluate(STATE, {"phase": phase, "selectRole": role})
            if not isinstance(selection, dict) or "error" in selection:
                raise RuntimeError("FILING_CONTROL_AMBIGUOUS" if isinstance(selection, dict)
                                   and selection.get("error") == "FILING_CONTROL_AMBIGUOUS"
                                   else "FILING_CONTROL_INVALID")
            if selection.get("index") is not None:
                await page.locator("select").nth(selection["index"]).select_option(selection["value"])
        await page.wait_for_timeout(100)
        metadata = await page.evaluate(STATE, {"phase": phase, "selectRole": None})
        if not isinstance(metadata, dict) or "error" in metadata:
            raise RuntimeError("FILING_CONTROL_INVALID")
        emit("filing_metadata", **metadata)
