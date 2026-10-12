"""Bounded public-control evidence, not a filing adapter or submission proof."""
from coverage_inspection import SELECT_MODE

METHOD = "playwright-filing-control-inventory-v6"
PHASES = ("INITIAL", "FILING", "ADVANCED", "COUNTY", "FINAL")
INVENTORY_ERRORS = frozenset({
    "FILING_FORM_MISSING", "FILING_CONTROL_INVALID", "FILING_WIDGET_LIMIT",
    "FILING_FORM_ELEMENT_LIMIT", "FILING_OPTION_LIMIT",
    "FILING_ARIA_REFERENCE_LIMIT", "FILING_GROUP_REFERENCE_LIMIT",
})

# Exact public vocabulary only. Unknown text, identifiers and values never emit.
INVENTORY = """({phase}) => {
  const form = document.querySelector('#btnSearch')?.form;
  if (!form) return {error: 'FILING_FORM_MISSING'};
  const vocabulary = ['Search By', 'Court', 'Courts', 'Court Type', 'Court Level',
    'Court System', 'Court Selection', 'Court Category', 'Court of Record',
    'Judicial District', 'County', 'Case Type', 'Case Category', 'Court Office',
    'Court Types', 'Case Types', 'Search All Courts', 'All Courts',
    'Search All Cases', 'All Cases', 'Include Closed Cases',
    'Advanced Search', 'Enable Advanced Search', 'Use Advanced Search',
    'Show Advanced Search', 'Limit Search', 'Restrict Search', 'Enable Filters',
    'CP Court', 'CP County', 'MDJ Court', 'MDJ County', 'MDC Court', 'MDC County',
    'Magisterial District Court', 'Magisterial District Courts', 'Court of Common Pleas',
    'Common Pleas Court', 'Originating Court', 'Originating County', 'Court Name',
    'Court Location', 'Docket Type', 'Docket Category', 'Case Status', 'Active Only',
    'Court Number', 'Court No', 'Court No.', 'Court #', 'Court Code', 'Court ID',
    'Court Identifier', 'Court Division', 'Court Jurisdiction', 'Court Offices',
    'Court Office(s)', 'Court(s)', 'Court (Required)', 'Court (Optional)',
    'Trial Court', 'Local Court', 'County Court', 'Municipal Court'];
  const publicWords = ['all','court','courts','case','cases','criminal','search','system',
    'type','types','county','closed','include','exclude','magisterial','district','common','pleas','level','by',
    'advanced','enable','enabled','show','options','filters','filter','limit','limited','restrict','restricted',
     'specific','within','only','use','criteria','cp','mdj','mdc','originating','location','docket','status','active',
     'number','no','code','id','identifier','division','jurisdiction','office','offices','required','optional',
     'trial','local','municipal'];
  const choices = {
    FILING: ['Date Filed', 'Filing Date', 'Date of Filing'],
    MDJ: ['Magisterial District Court', 'Magisterial District Courts', 'Magisterial District', 'MDJ'],
    COMMON_PLEAS: ['Common Pleas', 'Court of Common Pleas', 'Common Pleas Court', 'Common Pleas Courts'],
    ALLEGHENY: ['Allegheny'],
    CRIMINAL: ['Criminal']
  };
  const sensitive = /token|password|secret|session|cookie|captcha|verification|auth|birth|dob|defendant|participant|attorney|judge|docket|name|address|email|phone|ssn/i;
  const normalize = text => (text || '').trim().replace(/[:*]\\s*$/, '').trim().replace(/\\s+/g, ' ').toLowerCase();
  const category = text => Object.keys(choices).filter(key =>
    choices[key].some(label => normalize(label) === normalize(text)));
  const nodes = [...document.querySelectorAll('select,input[type=radio],input[type=checkbox],'
    + '[role=combobox],[role=radio],[role=tab],[role=menuitemradio],button,[role=button],a,[role=link]')];
  if (nodes.length > 128) return {error: 'FILING_WIDGET_LIMIT'};
  if (form.elements.length > 512) return {error: 'FILING_FORM_ELEMENT_LIMIT'};
  const data = new FormData(form);
  const controls = [];
  let omittedSensitiveControls = 0;
  for (const [ordinal, node] of nodes.entries()) {
    if (sensitive.test((node.name || '') + ' ' + (node.id || ''))) {
      omittedSensitiveControls++;
      continue;
    }
    const sources = [];
    for (const label of node.labels || []) sources.push(['LABEL', label.textContent]);
    const aria = node.getAttribute('aria-label');
    if (aria) sources.push(['ARIA', aria]);
    const labelledBy = (node.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
    const controlledIds = (node.getAttribute('aria-controls') || '').split(/\\s+/).filter(Boolean);
    if (labelledBy.length > 8 || controlledIds.length > 8) return {error: 'FILING_ARIA_REFERENCE_LIMIT'};
    for (const id of labelledBy) {
      const label = document.getElementById(id);
      if (label) sources.push(['ARIA', label.textContent]);
    }
    // Group evidence only; never infer a server binding or copy arbitrary text.
    const group = node.closest('fieldset,[role=group],[role=radiogroup]');
    if (group) {
      const legend = group.querySelector(':scope > legend');
      if (legend) sources.push(['GROUP', legend.textContent]);
      if (group.getAttribute('aria-label')) sources.push(['GROUP', group.getAttribute('aria-label')]);
      const groupIds = (group.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
      if (groupIds.length > 8) return {error: 'FILING_GROUP_REFERENCE_LIMIT'};
      for (const id of groupIds) {
        const label = document.getElementById(id);
        if (label) sources.push(['GROUP', label.textContent]);
      }
    }
    for (let p = node.parentElement, depth = 0; p && depth < 4; p = p.parentElement, depth++) {
      if (!p.id.endsWith('-Control')) continue;
      const label = [...document.querySelectorAll('label')].find(row => row.htmlFor === p.id.slice(0, -8));
      if (label) sources.push(['GROUP', label.textContent]);
      break;
    }
    const tag = node.tagName.toLowerCase(), role = node.getAttribute('role');
    const widget = tag === 'select' ? 'SELECT'
      : tag === 'a' || role === 'link' ? 'LINK'
      : ['combobox','radio','tab','menuitemradio'].includes(role) ? role.toUpperCase()
      : tag === 'input' ? node.type.toUpperCase() : 'BUTTON';
    if (widget !== 'SELECT' && widget !== 'COMBOBOX') sources.push(['TEXT', node.textContent]);
    const labels = vocabulary.filter(label => sources.some(([, text]) => normalize(text) === normalize(label)));
    // Closed generic words expose vocabulary gaps without recording raw labels.
    // Word presence is NOT an exact label, a control role or binding proof.
    const words = new Set(sources.flatMap(([, text]) => normalize(text).match(/[a-z]+/g) || []));
    const labelWords = publicWords.filter(word => words.has(word));
    const associations = ['LABEL','ARIA','GROUP','TEXT'].filter(key =>
      sources.some(([source, text]) => source === key && !!normalize(text)));
    let options = [], optionState = 'OBSERVED';
    if (widget === 'SELECT') {
      if (node.options.length > 2000) optionState = 'OVER_LIMIT';
      else options = [...node.options];
    }
    else if (widget === 'COMBOBOX') {
      const candidates = new Set();
      const containers = [node, ...controlledIds.map(id => document.getElementById(id)).filter(Boolean)];
      for (const container of containers) {
        for (const option of container.querySelectorAll('[role=option]')) {
          candidates.add(option);
          if (candidates.size > 2000) break;
        }
        if (candidates.size > 2000) break;
      }
      if (candidates.size > 2000) optionState = 'OVER_LIMIT';
      else options = [...candidates];
    }
    const publicChoices = Object.fromEntries(Object.keys(choices).map(key => [key, 0]));
    const selectedPublicChoices = Object.fromEntries(Object.keys(choices).map(key => [key, 0]));
    const isDisabled = el => el.matches(':disabled') || !!el.closest('[aria-disabled=true]');
    const increment = (text, selected) => {
      for (const key of category(text)) {
        publicChoices[key]++;
        if (selected) selectedPublicChoices[key]++;
      }
    };
    for (const option of options) if (!isDisabled(option))
      increment(option.textContent, option.selected === true || option.getAttribute('aria-selected') === 'true');
    if (!['SELECT','COMBOBOX'].includes(widget)) {
      // A checkbox/radio's own public label is its option; a group title is not.
      const ownChoices = new Set(sources.filter(([source]) => source !== 'GROUP')
        .flatMap(([, text]) => category(text)));
      for (const key of ownChoices) {
        publicChoices[key] = 1;
        selectedPublicChoices[key] = Number(node.checked === true
          || node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-selected') === 'true'
          || node.getAttribute('aria-pressed') === 'true');
      }
    }
    if (['BUTTON','LINK'].includes(widget) && !labels.length
      && !labelWords.length && !Object.values(publicChoices).some(Boolean)) continue;
    const ownership = node.form === form ? 'SEARCH' : node.form ? 'OTHER' : 'NONE';
    const nativeSuccessful = ownership === 'SEARCH' && !!node.name && !isDisabled(node)
      && ['SELECT','RADIO','CHECKBOX'].includes(widget)
      && (!['RADIO','CHECKBOX'].includes(widget) || node.checked)
      && data.getAll(node.name).some(value => value === node.value);
    controls.push({ordinal, widget, labels, labelWords, associations, hasPublicLabel: sources.some(([source, text]) =>
      source !== 'TEXT' && !!normalize(text)), visible: !!node.getClientRects().length,
      enabled: !isDisabled(node), ownership, optionState,
      optionCount: optionState === 'OVER_LIMIT' ? null : options.length,
      publicChoices: optionState === 'OVER_LIMIT' ? null : publicChoices,
      selectedPublicChoices: optionState === 'OVER_LIMIT' ? null : selectedPublicChoices,
      nativeSuccessful: !!nativeSuccessful});
  }
  const mode = document.querySelector('#SearchBy-Control select');
  const modeMatchesFiling = !!mode && mode.options.length <= 64 && !mode.matches(':disabled') && !!mode.getClientRects().length
    && [...mode.selectedOptions].some(option => !option.disabled && category(option.textContent).includes('FILING'));
  const advanced = controls.filter(row => row.widget === 'CHECKBOX' && row.labels.includes('Advanced Search'));
  const advancedSearch = {candidates: advanced.length,
    eligible: advanced.length === 1 && modeMatchesFiling && advanced[0].visible && advanced[0].enabled
      && advanced[0].ownership === 'SEARCH' && advanced[0].hasPublicLabel,
    checked: advanced.length === 1 ? nodes[advanced[0].ordinal].checked === true : null};
  const counties = controls.filter(row => row.widget === 'SELECT' && row.labels.includes('County'));
  const county = {candidates: counties.length,
    eligible: counties.length === 1 && advancedSearch.eligible && advancedSearch.checked === true
      && counties[0].visible && counties[0].enabled && counties[0].ownership === 'SEARCH'
      && counties[0].hasPublicLabel && counties[0].optionState === 'OBSERVED'
      && counties[0].publicChoices.ALLEGHENY === 1,
    selected: counties.length === 1 && counties[0].optionState === 'OBSERVED'
      ? counties[0].selectedPublicChoices.ALLEGHENY === 1 : null};
  return {method: 'playwright-filing-control-inventory-v6', phase, modeMatchesFiling,
    controls, omittedSensitiveControls, advancedSearch, county};
}"""

# Resolve an ephemeral ElementHandle from the same bounded, exact public-label
# inventory, never from a retained ordinal/identity or generic word match.
ADVANCED_NODE = """() => {
  const state = (""" + INVENTORY + """)({phase: 'FILING'});
  if (state.error || !state.modeMatchesFiling || !state.advancedSearch.eligible) return null;
  const row = state.controls.find(row => row.widget === 'CHECKBOX' && row.labels.includes('Advanced Search'));
  const nodes = document.querySelectorAll('select,input[type=radio],input[type=checkbox],'
    + '[role=combobox],[role=radio],[role=tab],[role=menuitemradio],button,[role=button],a,[role=link]');
  return nodes[row.ordinal] || null;
}"""

COUNTY_OPTION = """() => {
  const state = (""" + INVENTORY + """)({phase: 'ADVANCED'});
  if (state.error || !state.county.eligible) return null;
  const row = state.controls.find(row => row.widget === 'SELECT' && row.labels.includes('County'));
  const nodes = document.querySelectorAll('select,input[type=radio],input[type=checkbox],'
    + '[role=combobox],[role=radio],[role=tab],[role=menuitemradio],button,[role=button],a,[role=link]');
  return [...nodes[row.ordinal].options].find(option => !option.matches(':disabled')
    && !option.closest('[aria-disabled=true]')
    && option.textContent.trim().replace(/[:*]\\s*$/, '').trim().replace(/\\s+/g, ' ').toLowerCase() === 'allegheny') || null;
}"""


async def observe(page, emit, can_continue=lambda: True):
    for phase in PHASES:
        if not can_continue():
            raise RuntimeError("FILING_UNEXPECTED_LOCAL_REQUEST")
        if phase == "FILING":
            choice = await page.evaluate(SELECT_MODE, {"labels": ["Date Filed", "Filing Date", "Date of Filing"]})
            if not isinstance(choice, dict) or "error" in choice or choice.get("value") is None:
                raise RuntimeError("FILING_MODE_NOT_ESTABLISHED")
            await page.locator("#SearchBy-Control select").select_option(choice["value"])
        if phase == "ADVANCED":
            handle = await page.evaluate_handle(ADVANCED_NODE)
            try:
                checkbox = handle.as_element()
                if checkbox is None:
                    raise RuntimeError("FILING_ADVANCED_NOT_ESTABLISHED")
                # Idempotent check, not a toggle; never force hidden/disabled nodes.
                await checkbox.check(timeout=5_000)
            except Exception as error:
                raise RuntimeError("FILING_ADVANCED_NOT_ESTABLISHED") from error
            finally:
                await handle.dispose()
        if phase == "COUNTY":
            handle = await page.evaluate_handle(COUNTY_OPTION)
            select_handle = None
            try:
                option = handle.as_element()
                if option is None:
                    raise RuntimeError("FILING_COUNTY_NOT_ESTABLISHED")
                select_handle = await option.evaluate_handle("(option) => option.closest('select')")
                select = select_handle.as_element()
                if select is None:
                    raise RuntimeError("FILING_COUNTY_NOT_ESTABLISHED")
                if not await option.evaluate("(option) => option.selected"):
                    # Native selection of this ephemeral source option, not a guessed value.
                    await select.select_option(element=option, timeout=5_000)
            except Exception as error:
                raise RuntimeError("FILING_COUNTY_NOT_ESTABLISHED") from error
            finally:
                if select_handle is not None:
                    await select_handle.dispose()
                await handle.dispose()
        await page.wait_for_timeout(100)
        if not can_continue():
            raise RuntimeError("FILING_UNEXPECTED_LOCAL_REQUEST")
        metadata = await page.evaluate(INVENTORY, {"phase": phase})
        if not isinstance(metadata, dict) or "error" in metadata:
            code = metadata.get("error") if isinstance(metadata, dict) else None
            raise RuntimeError(code if isinstance(code, str) and code in INVENTORY_ERRORS
                               else "FILING_CONTROL_INVALID")
        if phase in ("ADVANCED", "COUNTY", "FINAL") and not (
                metadata.get("modeMatchesFiling") is True
                and metadata.get("advancedSearch", {}).get("eligible") is True
                and metadata.get("advancedSearch", {}).get("checked") is True):
            raise RuntimeError("FILING_ADVANCED_NOT_ESTABLISHED")
        if phase in ("COUNTY", "FINAL") and not (
                metadata.get("county", {}).get("eligible") is True
                and metadata.get("county", {}).get("selected") is True):
            raise RuntimeError("FILING_COUNTY_NOT_ESTABLISHED")
        emit("filing_metadata", **metadata)
