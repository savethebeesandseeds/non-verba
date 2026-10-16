// SPDX-License-Identifier: AGPL-3.0-only
import {
  validateProject,
  flattenMilestones,
  summarize,
  summarizeGoal,
  deriveHeroStatus,
  deriveGoalStatus,
  filterHeroes,
  STATUS_LABELS,
} from "./model.js";

const byId = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  "refresh", "retry", "load-state", "load-error", "error-message", "dashboard",
  "updated-at", "overview-counts", "hero-count",
  "hero-nav", "heroes-title", "visible-count", "search", "status-filter",
  "reset", "empty-reset", "expand-all", "collapse-all", "hero-list", "empty-state",
  "file-source",
  "project-progress", "scope-summary", "hero-map", "focus-list",
  "project-intro", "hierarchy-key", "project-overview", "workspace",
  "project-results", "project-empty", "project-reset", "search-label", "detail-toolbar",
].map((id) => [id, byId(id)]));

const state = {
  heroes: [], milestoneIndex: new Map(), heroId: null, goalId: null, query: "", status: "all",
  openMilestones: new Set(),
  collapsedGoals: new Set(),
};
const dateFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function icon(name) {
  const paths = {
    overview: "M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z",
    external: "M7 17 17 7M7 7h10v10",
    chevron: "m9 5 7 7-7 7",
    document: "M7 3h7l4 4v14H7zM14 3v5h4M10 12h5M10 16h5",
    done: "m5 12 4 4L19 6",
    in_progress: "m8 5 11 7-11 7z",
    ready: "M5 12h14m-6-6 6 6-6 6",
    blocked: "M8 6v12M16 6v12",
    proposed: "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "interface-icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name]);
  svg.append(path);
  return svg;
}

function dateLabel(value) {
  if (!value) return "Not recorded";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

function badge(status, label = STATUS_LABELS[status] || "Unknown state") {
  return node("span", `status-badge status-${status}`, label);
}

function heroAvatar(hero, className) {
  const image = node("img", className);
  const branding = window.NonVerbaDashboardBranding;
  image.src = branding?.heroes?.[hero.id] || branding?.portrait || "";
  image.alt = "";
  image.width = 144;
  image.height = 144;
  return image;
}

function progressMeter(counts, className, label) {
  const meter = node("progress", className);
  meter.max = Math.max(counts.total, 1);
  meter.value = counts.done;
  meter.setAttribute("aria-label", `${label}: ${counts.done} of ${counts.total} milestones done`);
  meter.title = `${counts.done} of ${counts.total} tracked milestones done`;
  return meter;
}

function completionRing(counts) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("class", `goal-ring${counts.total ? "" : " goal-ring-empty"}${counts.done ? "" : " goal-ring-zero"}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const className of ["goal-ring-track", "goal-ring-fill"]) {
    const circle = document.createElementNS(svg.namespaceURI, "circle");
    circle.setAttribute("class", className);
    circle.setAttribute("cx", "24");
    circle.setAttribute("cy", "24");
    circle.setAttribute("r", "20");
    circle.setAttribute("pathLength", "100");
    if (className === "goal-ring-fill") circle.setAttribute("stroke-dasharray", `${counts.total ? counts.done / counts.total * 100 : 0} 100`);
    svg.append(circle);
  }
  const value = document.createElementNS(svg.namespaceURI, "text");
  value.setAttribute("class", "goal-ring-value");
  value.setAttribute("x", "24");
  value.setAttribute("y", "24");
  value.setAttribute("text-anchor", "middle");
  value.setAttribute("dominant-baseline", "central");
  value.textContent = counts.total ? `${counts.done}/${counts.total}` : "—";
  svg.append(value);
  return svg;
}

function selectHero(id) {
  if (id === "all") return showOverview();
  if (!state.heroes.some((hero) => hero.id === id)) return;
  state.heroId = id;
  state.goalId = null;
  state.query = "";
  state.status = "all";
  ui.search.value = "";
  ui["status-filter"].value = "all";
  renderNavigation();
  renderHeroes();
  const main = byId("heroes");
  main.scrollIntoView({ block: "start", behavior: "auto" });
  main.focus({ preventScroll: true });
}

function showOverview() {
  state.heroId = null;
  state.goalId = null;
  state.query = "";
  state.status = "all";
  ui.search.value = "";
  ui["status-filter"].value = "all";
  renderNavigation();
  renderHeroes();
  focusOverview();
}

function focusOverview() {
  const heading = byId("hero-map-title");
  heading.tabIndex = -1;
  heading.scrollIntoView({ block: "start", behavior: "auto" });
  heading.focus({ preventScroll: true });
}

function selectGoal(id) {
  const hero = state.heroes.find((candidate) => candidate.id === state.heroId);
  if (!hero?.goals.some((goal) => goal.id === id)) return;
  state.goalId = id;
  state.collapsedGoals.delete(id);
  updateGoalDetail(hero);
  ui["hero-list"].querySelector(`.goal-tile[data-goal-id="${id}"]`)?.focus({ preventScroll: true });
}

function clearGoal() {
  const previousId = state.goalId;
  const hero = state.heroes.find((candidate) => candidate.id === state.heroId);
  if (!hero) return;
  state.goalId = null;
  updateGoalDetail(hero);
  ui["hero-list"].querySelector(`.goal-tile[data-goal-id="${previousId}"]`)?.focus({ preventScroll: true });
}

function filterState(status) {
  state.heroId = null;
  state.goalId = null;
  state.query = "";
  state.status = status;
  ui.search.value = "";
  ui["status-filter"].value = status;
  renderNavigation();
  renderHeroes();
  focusOverview();
}

function syncSelections() {
  for (const button of ui["overview-counts"].querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(state.status === button.dataset.status && state.heroId === null && !state.query.trim()));
  }
  for (const button of ui["hero-map"].querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(state.heroId === button.dataset.heroId));
  }
  for (const button of ui["hero-nav"].querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(state.heroId === (button.dataset.heroId === "all" ? null : button.dataset.heroId)));
  }
  for (const button of ui["hero-list"].querySelectorAll(".goal-tile")) {
    const selected = state.goalId === button.dataset.goalId;
    button.setAttribute("aria-pressed", String(selected));
    button.querySelector(".goal-tile-open-label").textContent = selected ? "Viewing Goal" : "View Goal";
  }
}

function rollupBadge(status, counts, level) {
  const partial = status === "in_progress" && counts.active === 0 && counts.done > 0 && counts.done < counts.total;
  const label = counts.total === 0 ? "No milestones" : status === "done" ? "Recorded complete" : partial ? "Partially complete" : STATUS_LABELS[status];
  const element = badge(status, label);
  if (partial) element.classList.add("status-partial");
  element.title = `State summarizes only the listed milestones in this ${level}; broader work may be unrecorded.`;
  element.setAttribute("aria-label", `${level} milestone summary: ${element.textContent}`);
  return element;
}

function repositoryLink(path) {
  if (typeof path !== "string") return null;
  const [file, ...fragment] = path.split("#");
  if (!file || file.startsWith("/") || file.includes("\\") || /^[a-z]+:/i.test(file)
      || file.split("/").some((part) => !part || part === ".." || part === ".")) return null;
  return `../../${file.split("/").map(encodeURIComponent).join("/")}${fragment.length ? `#${encodeURIComponent(fragment.join("#"))}` : ""}`;
}

function renderOverview() {
  const summary = summarize(state.heroes);
  const definitions = [["total", "Tracked milestones", summary.total], ["done", "Done", summary.done],
    ["in_progress", "In progress", summary.active], ["blocked", "Blocked", summary.blocked],
    ["ready", "Ready", summary.ready], ["proposed", "Proposed", summary.proposed]];
  const stats = definitions.map(([key, label, count]) => {
    const card = node("button", `stat stat-${key}`);
    card.type = "button";
    card.dataset.status = key === "total" ? "all" : key;
    card.setAttribute("aria-controls", "hero-map");
    card.setAttribute("aria-label", key === "total" ? `Show all ${count} tracked milestones` : `Show ${count} ${label.toLowerCase()} milestones`);
    card.addEventListener("click", () => filterState(card.dataset.status));
    const labelNode = node("span", "stat-label");
    if (key !== "total") {
      const dot = node("span", "status-dot");
      dot.setAttribute("aria-hidden", "true");
      labelNode.append(dot);
    }
    labelNode.append(document.createTextNode(label));
    card.append(labelNode, node("span", "stat-value", String(count)));
    return card;
  });
  ui["overview-counts"].replaceChildren(...stats);
  ui["hero-count"].textContent = state.heroes.length;
  const goals = state.heroes.reduce((count, hero) => count + hero.goals.length, 0);
  ui["scope-summary"].textContent = `${state.heroes.length} Heroes · ${goals} Goals`;
  const progressLabel = node("p", "project-progress-label");
  progressLabel.append(node("strong", "", `${summary.done} / ${summary.total}`), document.createTextNode(" recorded milestones complete"));
  ui["project-progress"].replaceChildren(progressLabel, progressMeter(summary, "project-progress-meter", "Project record completion"));
  const dates = state.heroes.map((hero) => hero.updatedAt).filter(Boolean).sort();
  ui["updated-at"].textContent = dates.length ? `Latest record update · ${dateLabel(dates.at(-1))}` : "No update date recorded";
}

function renderHeroMap(filtered) {
  const filtering = Boolean(state.query.trim()) || state.status !== "all";
  const tiles = filtered.map((match) => {
    const hero = state.heroes.find((candidate) => candidate.id === match.id);
    const counts = summarize([hero]);
    const tile = node("button", "hero-tile");
    tile.type = "button";
    tile.dataset.heroId = hero.id;
    tile.setAttribute("aria-controls", "hero-list");
    tile.setAttribute("aria-pressed", "false");
    tile.setAttribute("aria-label", `Explore Hero ${hero.number}: ${hero.title}. ${counts.done} of ${counts.total} milestones done.`);
    const top = node("span", "hero-tile-top");
    top.append(node("span", "hero-tile-number", String(hero.number).padStart(2, "0")), heroAvatar(hero, "hero-tile-avatar"));
    const title = node("span", "hero-tile-title", hero.title);
    const metadata = node("span", "hero-tile-meta");
    const count = node("span", "hero-tile-count", `${counts.done}/${counts.total}`);
    count.setAttribute("aria-label", `${counts.done} of ${counts.total} milestones done`);
    metadata.append(node("span", "", `${hero.goals.length} Goals`), count);
    const status = rollupBadge(deriveHeroStatus(hero), counts, "Hero");
    status.classList.add("hero-tile-status");
    tile.append(top, title, metadata, progressMeter(counts, "hero-tile-progress", hero.title), status);
    if (filtering) tile.append(node("span", "hero-tile-match", `${summarize([match]).total} matching milestones`));
    tile.addEventListener("click", () => selectHero(hero.id));
    return tile;
  });
  ui["hero-map"].replaceChildren(...tiles);
  ui["project-results"].textContent = filtering
    ? `${filtered.length} of ${state.heroes.length} Heroes · ${summarize(filtered).total} matching milestones`
    : `${state.heroes.length} Heroes · ${state.heroes.reduce((total, hero) => total + hero.goals.length, 0)} Goals · Choose a Hero to explore`;
  ui["project-empty"].hidden = filtered.length > 0;
}

function renderFocus() {
  const current = flattenMilestones(state.heroes)
    .filter(({milestone}) => milestone.status === "blocked" || milestone.status === "in_progress")
    .sort((left, right) => Number(right.milestone.status === "blocked") - Number(left.milestone.status === "blocked"));
  if (!current.length) {
    const empty = node("div", "focus-empty");
    empty.append(node("p", "", "No active or blocked milestones."), node("p", "", "Explore the Heroes to see what is ready or proposed."));
    ui["focus-list"].replaceChildren(empty);
    return;
  }
  const cards = current.slice(0, 4).map(({milestone, hero, goal}) => {
    const card = node("button", `focus-card focus-${milestone.status}`);
    card.type = "button";
    card.dataset.milestoneId = milestone.id;
    card.setAttribute("aria-controls", "hero-list");
    const label = node("span", "focus-label");
    label.append(badge(milestone.status));
    card.append(label, node("span", "focus-title", milestone.title), node("span", "focus-context", `Hero ${String(hero.number).padStart(2, "0")} · ${hero.title} / ${goal.title}`));
    card.addEventListener("click", () => revealMilestone(milestone.id));
    return card;
  });
  if (current.length > 4) {
    const more = node("button", "text-button focus-more", `Explore the Heroes · ${current.length} active or blocked`);
    more.type = "button";
    more.addEventListener("click", showOverview);
    cards.push(more);
  }
  ui["focus-list"].replaceChildren(...cards);
}

function renderNavigation() {
  const focusedHero = document.activeElement?.dataset.heroId;
  const allCounts = summarize(state.heroes);
  const definitions = [{ id: "all", number: "◎", title: "Project overview", counts: allCounts },
    ...state.heroes.map((hero) => ({ ...hero, counts: summarize([hero]) }))];
  const buttons = definitions.map((hero) => {
    const button = node("button", `nav-button${hero.id === "all" ? " nav-all" : ""}`);
    button.type = "button";
    button.dataset.heroId = hero.id;
    button.setAttribute("aria-pressed", String(state.heroId === (hero.id === "all" ? null : hero.id)));
    button.setAttribute("aria-controls", hero.id === "all" ? "project-overview" : "hero-list");
    const number = hero.id === "all" ? node("span", "nav-number") : heroAvatar(hero, "nav-avatar");
    if (hero.id === "all") number.append(icon("overview"));
    if (hero.id === "all") number.setAttribute("aria-hidden", "true");
    const count = node("span", "nav-count", `${hero.counts.done}/${hero.counts.total}`);
    count.setAttribute("aria-label", `${hero.counts.done} of ${hero.counts.total} milestones done`);
    const title = node("span", "nav-title");
    if (hero.id !== "all") {
      const index = node("span", "nav-index", `Hero ${String(hero.number).padStart(2, "0")}`);
      const dot = rollupBadge(deriveHeroStatus(hero), hero.counts, "Hero");
      dot.classList.replace("status-badge", "nav-status-dot");
      dot.textContent = "";
      dot.setAttribute("role", "img");
      dot.title = `${dot.getAttribute("aria-label")}. ${hero.counts.done} of ${hero.counts.total} recorded milestones done.`;
      index.append(dot);
      title.append(index);
    }
    title.append(document.createTextNode(hero.title));
    button.append(number, title, count);
    button.addEventListener("click", () => selectHero(hero.id));
    return button;
  });
  ui["hero-nav"].replaceChildren(...buttons);
  if (focusedHero) buttons.find((button) => button.dataset.heroId === focusedHero)?.focus({ preventScroll: true });
}

function field(title, className, count) {
  const section = node("section", `field ${className || ""}`.trim());
  const heading = node("div", "field-heading");
  heading.append(node("h5", "", title));
  if (count !== undefined) heading.append(node("span", "field-count", String(count)));
  section.append(heading);
  return section;
}

function setGoalExpanded(id, expanded) {
  if (expanded) state.collapsedGoals.delete(id);
  else state.collapsedGoals.add(id);
  const panel = byId(`milestones-${id}`), toggle = byId(`toggle-${id}`);
  if (panel) panel.hidden = !expanded;
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", `${expanded ? "Hide" : "Show"} milestones for ${toggle.dataset.goalTitle}`);
    toggle.querySelector(".goal-toggle-label").textContent = expanded ? "Hide milestones" : "Show milestones";
  }
}

function revealMilestone(id) {
  const target = state.milestoneIndex.get(id);
  if (!target) return;
  state.heroId = target.hero.id;
  state.goalId = target.goal.id;
  state.query = "";
  state.status = "all";
  ui.search.value = "";
  ui["status-filter"].value = "all";
  renderNavigation();
  renderHeroes();
  setGoalExpanded(target.goal.id, true);
  const element = byId(`item-${id}`);
  if (!element) return;
  element.open = true;
  state.openMilestones.add(id);
  element.scrollIntoView({ block: "center", behavior: "auto" });
  element.querySelector("summary").focus({ preventScroll: true });
}

function renderMilestone(milestone, originalGoal) {
  const details = node("details", `milestone milestone-status-${milestone.status}`);
  details.id = `item-${milestone.id}`;
  details.dataset.status = milestone.status;
  details.open = state.openMilestones.has(milestone.id);
  details.addEventListener("toggle", () => {
    if (!details.isConnected) return;
    if (details.open) state.openMilestones.add(milestone.id);
    else state.openMilestones.delete(milestone.id);
  });
  const summary = node("summary", "milestone-header");
  const marker = node("span", `milestone-marker status-${milestone.status}`);
  marker.append(icon(milestone.status));
  marker.setAttribute("aria-hidden", "true");
  const main = node("span", "milestone-summary-main");
  const ordinal = originalGoal.milestones.findIndex(({id}) => id === milestone.id) + 1;
  main.append(node("span", "milestone-step", `Milestone ${String(ordinal).padStart(2, "0")}`), node("span", "milestone-title", milestone.title));
  if (milestone.description) {
    if (milestone.status === "blocked") main.append(node("span", "milestone-context-label", "Why this is blocked"));
    main.append(node("span", "milestone-preview", milestone.description));
  }
  const quick = [];
  if (milestone.acceptance?.length) quick.push(`${milestone.acceptance.length} ${milestone.acceptance.length === 1 ? "criterion" : "criteria"}`);
  if (milestone.evidence?.length) quick.push(`${milestone.evidence.length} evidence ${milestone.evidence.length === 1 ? "link" : "links"}`);
  if (milestone.dependsOn?.length) quick.push(`${milestone.dependsOn.length} ${milestone.dependsOn.length === 1 ? "dependency" : "dependencies"}`);
  if (quick.length) main.append(node("span", "milestone-quick-meta", quick.join(" · ")));
  const arrow = node("span", "disclosure");
  arrow.append(icon("chevron"));
  arrow.setAttribute("aria-hidden", "true");
  summary.append(marker, main, badge(milestone.status), arrow);
  details.append(summary);

  const body = node("div", "milestone-body");
  const fields = node("div", "milestone-fields");
  const acceptance = field("Acceptance criteria", "field-acceptance", milestone.acceptance?.length || 0);
  if (milestone.acceptance?.length) {
    const list = node("ol", "criteria-list");
    milestone.acceptance.forEach((criterion, index) => {
      const item = node("li");
      const number = node("span", "criterion-number", String(index + 1).padStart(2, "0"));
      number.setAttribute("aria-hidden", "true");
      item.append(number, node("span", "criterion-copy", criterion));
      list.append(item);
    });
    acceptance.append(list);
  } else acceptance.append(node("p", "field-empty", "Criteria not yet recorded."));

  const evidence = field("Evidence", "field-evidence", milestone.evidence?.length || 0);
  if (milestone.evidence?.length) {
    const list = node("ul");
    for (const record of milestone.evidence) {
      const entry = node("li");
      const href = repositoryLink(record.path);
      if (href) {
        const link = node("a", "evidence-link");
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener";
        link.title = `${record.path} (opens in a new tab)`;
        const mark = node("span", "evidence-icon");
        mark.append(icon("document"));
        const content = node("span", "evidence-content");
        content.append(node("span", "evidence-label", record.label), node("span", "evidence-path", record.path.split("#")[0].split("/").at(-1)));
        const arrow = node("span", "evidence-arrow");
        arrow.append(icon("external"));
        arrow.setAttribute("aria-hidden", "true");
        link.append(mark, content, arrow);
        entry.append(link);
      } else entry.append(node("span", "", `${record.label} — invalid evidence path`));
      list.append(entry);
    }
    evidence.append(list);
  } else evidence.append(node("p", "field-empty", "No evidence linked yet."));
  fields.append(acceptance, evidence);

  if (milestone.dependsOn?.length) {
    const dependencies = field("Dependencies", "field-dependencies", milestone.dependsOn.length);
    const list = node("ul");
    for (const id of milestone.dependsOn) {
      const entry = node("li");
      const target = state.milestoneIndex.get(id);
      if (target) {
        const button = node("button", "dependency-button");
        button.type = "button";
        button.dataset.milestoneId = id;
        button.append(node("span", "dependency-title", target.milestone.title), badge(target.milestone.status), icon("external"));
        button.addEventListener("click", () => revealMilestone(id));
        entry.append(button);
      } else entry.textContent = `${id} · dependency unavailable`;
      list.append(entry);
    }
    dependencies.append(list);
    fields.append(dependencies);
  }

  const metadata = node("div", "metadata");
  const recordedMetadata = [];
  if (Object.hasOwn(milestone, "owner")) recordedMetadata.push(["Owner", milestone.owner || "Unassigned"]);
  if (milestone.updatedAt) recordedMetadata.push(["Updated", dateLabel(milestone.updatedAt)]);
  if (milestone.completedAt) recordedMetadata.push(["Completed", dateLabel(milestone.completedAt)]);
  for (const [label, value] of recordedMetadata) {
    const entry = node("span");
    entry.append(node("strong", "", `${label}: `), document.createTextNode(value));
    metadata.append(entry);
  }
  const reference = node("details", "record-reference");
  const referenceLabel = node("summary", "", "Record ID");
  referenceLabel.title = "Use this stable ID to find the milestone in its Hero JSON.";
  reference.append(referenceLabel, node("code", "item-id", milestone.id));
  metadata.append(reference);
  fields.append(metadata);
  body.append(fields);
  details.append(body);
  return details;
}

function renderGoal(goal, originalHero) {
  const original = originalHero.goals.find((candidate) => candidate.id === goal.id);
  const counts = summarizeGoal(original);
  const group = node("section", "goal-card");
  group.id = `goal-${goal.id}`;
  group.setAttribute("aria-labelledby", `goal-title-${goal.id}`);
  const header = node("div", "goal-header");
  const heading = node("div", "goal-heading");
  const headingMain = node("div", "goal-heading-main");
  const titleWrap = node("div");
  const goalNumber = originalHero.goals.indexOf(original) + 1;
  headingMain.append(node("span", "goal-number", String(goalNumber).padStart(2, "0")));
  titleWrap.append(node("p", "goal-eyebrow", "Goal"));
  const title = node("h4", "goal-title", goal.title);
  title.id = `goal-title-${goal.id}`;
  title.tabIndex = -1;
  titleWrap.append(title);
  headingMain.append(titleWrap);
  const actions = node("div", "goal-heading-actions");
  actions.append(rollupBadge(deriveGoalStatus(original), counts, "Goal"));
  const expanded = !state.collapsedGoals.has(goal.id) || Boolean(state.query.trim()) || state.status !== "all";
  if (counts.total) {
    const toggle = node("button", "goal-toggle");
    toggle.id = `toggle-${goal.id}`;
    toggle.type = "button";
    toggle.dataset.goalTitle = goal.title;
    toggle.setAttribute("aria-controls", `milestones-${goal.id}`);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", `${expanded ? "Hide" : "Show"} milestones for ${goal.title}`);
    toggle.append(icon("chevron"), node("span", "goal-toggle-label", expanded ? "Hide milestones" : "Show milestones"));
    toggle.addEventListener("click", () => setGoalExpanded(goal.id, byId(`milestones-${goal.id}`).hidden));
    actions.append(toggle);
  }
  heading.append(headingMain, actions);
  header.append(heading);
  if (goal.description) header.append(node("p", "goal-description", goal.description));
  const count = node("p", "goal-count", `${counts.done} of ${counts.total} milestones done`);
  if (goal.milestones.length !== original.milestones.length) count.append(document.createTextNode(` · ${goal.milestones.length} visible`));
  header.append(count, progressMeter(counts, "goal-progress", goal.title));
  const states = node("div", "goal-state-counts");
  states.setAttribute("aria-label", "States of all milestones in this Goal");
  for (const status of ["done", "in_progress", "blocked", "ready", "proposed"]) {
    if (counts.counts[status]) states.append(node("span", `goal-state-count status-${status}`, `${counts.counts[status]} ${STATUS_LABELS[status].toLowerCase()}`));
  }
  if (states.childElementCount) header.append(states);
  const milestones = node("div", "milestones");
  milestones.id = `milestones-${goal.id}`;
  milestones.dataset.goalId = goal.id;
  milestones.hidden = !expanded;
  milestones.append(...goal.milestones.map((milestone) => renderMilestone(milestone, original)));
  if (goal.milestones.length === 0) {
    const empty = node("div", "goal-milestones-empty");
    empty.append(node("p", "milestone-description", original.milestones.length ? "No milestones match these filters in this Goal." : "No Milestones defined yet."));
    if (original.milestones.length) {
      const reset = node("button", "button button-quiet", "Reset filters");
      reset.type = "button";
      reset.addEventListener("click", resetFilters);
      empty.append(reset);
    }
    milestones.append(empty);
  }
  group.append(header, milestones);
  return group;
}

function renderGoalTile(goal, originalHero) {
  const original = originalHero.goals.find((candidate) => candidate.id === goal.id);
  const counts = summarizeGoal(original);
  const ordinal = originalHero.goals.indexOf(original) + 1;
  const tile = node("button", "goal-tile");
  tile.type = "button";
  tile.dataset.goalId = goal.id;
  tile.setAttribute("aria-controls", "goal-detail");
  tile.setAttribute("aria-pressed", String(state.goalId === goal.id));
  tile.setAttribute("aria-label", `Explore Goal ${ordinal}: ${original.title}. ${counts.done} of ${counts.total} milestones done.`);
  const top = node("span", "goal-tile-top");
  top.append(node("span", "goal-tile-number", `Goal ${String(ordinal).padStart(2, "0")}`), rollupBadge(deriveGoalStatus(original), counts, "Goal"));
  const body = node("span", "goal-tile-body");
  const copy = node("span", "goal-tile-copy");
  copy.append(node("span", "goal-tile-title", original.title));
  if (original.description) copy.append(node("span", "goal-tile-description", original.description));
  body.append(completionRing(counts), copy);
  const footer = node("span", "goal-tile-footer");
  const strip = node("span", "goal-state-strip");
  strip.setAttribute("aria-hidden", "true");
  for (const milestone of original.milestones) {
    const dot = node("span", `goal-state-dot status-${milestone.status}`);
    dot.title = `${milestone.title} · ${STATUS_LABELS[milestone.status]}`;
    strip.append(dot);
  }
  footer.append(node("span", "goal-tile-count", `${counts.done} of ${counts.total} milestones done`), strip);
  tile.append(top, body, footer, progressMeter(counts, "goal-tile-progress", original.title));
  if (state.query.trim() || state.status !== "all") tile.append(node("span", "goal-tile-match", `${goal.milestones.length} matching milestones`));
  if ((state.query.trim() || state.status !== "all") && goal.milestones.length === 0) tile.classList.add("goal-tile-no-match");
  const open = node("span", "goal-tile-open");
  open.append(node("span", "goal-tile-open-label", state.goalId === goal.id ? "Viewing Goal" : "View Goal"), icon("chevron"));
  tile.append(open);
  tile.addEventListener("click", () => selectGoal(goal.id));
  return tile;
}

function projectedGoals(hero, matchingGoals = filterHeroes([hero], { query: state.query, status: state.status })[0]?.goals || []) {
  return hero.goals.map((goal) => matchingGoals.find((match) => match.id === goal.id) || { ...goal, milestones: [] });
}

function populateGoalDetail(detail, hero, goals) {
  const selectedGoal = goals.find((goal) => goal.id === state.goalId);
  ui["detail-toolbar"].remove();
  ui["detail-toolbar"].hidden = !selectedGoal?.milestones.length;
  ui["expand-all"].disabled = !selectedGoal?.milestones.length;
  ui["collapse-all"].disabled = !selectedGoal?.milestones.length;
  detail.dataset.goalId = selectedGoal?.id || "";
  const content = node("div", "goal-detail-content");
  if (selectedGoal) {
    detail.setAttribute("aria-labelledby", `goal-title-${selectedGoal.id}`);
    detail.removeAttribute("aria-label");
    const heading = node("div", "goal-detail-heading");
    const clear = node("button", "text-button goal-clear", "Goals overview");
    clear.type = "button";
    clear.append(icon("overview"));
    clear.addEventListener("click", clearGoal);
    heading.append(node("p", "eyebrow", "Selected Goal"), clear);
    content.append(heading, ui["detail-toolbar"], renderGoal(selectedGoal, hero));
  } else {
    detail.removeAttribute("aria-labelledby");
    detail.setAttribute("aria-label", "Goal details");
    const empty = node("div", "goal-selection-empty");
    empty.append(icon("overview"), node("h4", "", hero.goals.length ? "Choose a Goal to explore" : "No Goals defined yet."));
    if (hero.goals.length) empty.append(node("p", "", "Select a Goal to see its milestones, acceptance criteria and evidence here."));
    else empty.append(node("p", "", "This Hero is a planning record. Add Goals as its scope becomes concrete."));
    content.append(empty);
  }
  detail.replaceChildren(content);
  return selectedGoal;
}

function captureMilestoneState() {
  // Native toggle events may arrive after a quick selection/search/reset. Capture
  // the actual displayed state before replacing details so the latest click wins.
  for (const details of ui["hero-list"].querySelectorAll("details.milestone")) {
    const id = details.id.slice("item-".length);
    if (details.open) state.openMilestones.add(id);
    else state.openMilestones.delete(id);
  }
}

function updateGoalDetail(hero) {
  const detail = byId("goal-detail");
  if (!detail) return;
  captureMilestoneState();
  const goals = projectedGoals(hero);
  const selected = populateGoalDetail(detail, hero, goals);
  const announcement = byId("goal-selection-status");
  announcement.textContent = selected
    ? `Goal ${hero.goals.findIndex((goal) => goal.id === selected.id) + 1}: ${selected.title} selected. ${selected.milestones.length} milestones shown.`
    : "Goals overview. Choose a Goal to explore.";
  ui["empty-state"].hidden = Boolean(selected) || filterHeroes([hero], { query: state.query, status: state.status }).length > 0;
  syncSelections();
}

function renderHero(hero, matchingGoals) {
  const counts = summarize([hero]);
  const goals = projectedGoals(hero, matchingGoals);
  const card = node("section", "hero-card");
  card.id = `hero-${hero.id}`;
  card.setAttribute("aria-labelledby", `hero-title-${hero.id}`);
  const header = node("div", "hero-header");
  const heading = node("div", "hero-heading");
  const number = heroAvatar(hero, "hero-avatar");
  const titleWrap = node("div");
  titleWrap.append(node("p", "hero-eyebrow", `Hero ${String(hero.number).padStart(2, "0")}`));
  const title = node("h3", "", hero.title);
  title.id = `hero-title-${hero.id}`;
  titleWrap.append(title);
  heading.append(number, titleWrap, rollupBadge(deriveHeroStatus(hero), counts, "Hero"));
  header.append(heading, node("p", "hero-summary", hero.summary));
  const metadata = node("div", "hero-meta");
  metadata.append(node("span", "completion-count", `${counts.done} of ${counts.total} milestones done`));
  metadata.append(node("span", "", `${hero.goals.length} Goals`));
  if (counts.active) metadata.append(node("span", "", `${counts.active} in progress`));
  if (counts.blocked) metadata.append(node("span", "", `${counts.blocked} blocked`));
  const separator = node("span", "meta-separator", "/");
  separator.setAttribute("aria-hidden", "true");
  metadata.append(separator, node("span", "", `Updated ${dateLabel(hero.updatedAt)}`));
  header.append(metadata, progressMeter(counts, "hero-progress", hero.title));
  const selector = node("section", "goal-selector");
  selector.setAttribute("aria-labelledby", "goal-selector-title");
  const selectorHeading = node("div", "goal-selector-heading");
  const selectorTitle = node("h4", "", "Explore the Goals");
  selectorTitle.id = "goal-selector-title";
  selectorTitle.tabIndex = -1;
  selectorHeading.append(selectorTitle, node("p", "goal-selector-note", hero.goals.length ? "Choose a Goal to see its details and milestones." : "Goals will appear here as their scope is defined."));
  const grid = node("div", "goal-grid");
  grid.tabIndex = hero.goals.length ? 0 : -1;
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", `Goal choices in ${hero.title}`);
  grid.append(...goals.map((goal) => renderGoalTile(goal, hero)));
  const announcement = node("p", "sr-only goal-selection-status");
  announcement.id = "goal-selection-status";
  announcement.setAttribute("role", "status");
  announcement.setAttribute("aria-live", "polite");
  announcement.setAttribute("aria-atomic", "true");
  selector.append(selectorHeading, announcement, grid);

  const detail = node("section", "goal-detail");
  detail.id = "goal-detail";
  populateGoalDetail(detail, hero, goals);
  const explorer = node("div", "goal-explorer");
  explorer.append(selector, detail);
  card.append(header, explorer);
  return card;
}

function renderHeroes() {
  captureMilestoneState();
  const previousHero = ui["hero-list"].querySelector(".hero-card");
  const previousGrid = previousHero?.querySelector(".goal-grid");
  const goalScroll = previousHero?.id === `hero-${state.heroId}` && previousGrid
    ? { top: previousGrid.scrollTop, left: previousGrid.scrollLeft } : null;
  const selected = state.heroes.find((hero) => hero.id === state.heroId);
  const filtered = filterHeroes(state.heroes, { query: state.query, status: state.status, heroId: selected?.id || "all" });
  const matchingGoals = selected ? filtered[0]?.goals || [] : [];
  if (!selected?.goals.some((goal) => goal.id === state.goalId)) state.goalId = null;
  const selectedGoal = matchingGoals.find((goal) => goal.id === state.goalId);
  // Retain the common toolbar and its event listeners when replacing the detail.
  ui["detail-toolbar"].remove();
  ui["detail-toolbar"].hidden = !selectedGoal?.milestones.length;
  for (const id of ["project-intro", "hierarchy-key", "project-overview", "project-results"]) ui[id].hidden = Boolean(selected);
  ui.workspace.hidden = !selected;
  const skipLink = document.querySelector(".skip-link");
  skipLink.href = selected ? "#heroes" : "#hero-map-title";
  skipLink.textContent = selected ? "Skip to Hero details" : "Skip to Heroes overview";
  ui["search-label"].textContent = selected ? "Search this Hero’s Goals and milestones" : "Search Heroes, Goals and milestones";
  ui.search.placeholder = selected ? "Goal, milestone, evidence, owner…" : "Hero, Goal, milestone, evidence…";
  ui["heroes-title"].textContent = selected ? selected.title : "Hero details";
  const visibleMilestones = summarize(filtered).total;
  const filtering = Boolean(state.query.trim()) || state.status !== "all";
  ui["visible-count"].textContent = selected ? `${filtering ? `${matchingGoals.length} of ${selected.goals.length} Goals match` : `${selected.goals.length} Goals`} · ${visibleMilestones} ${filtering ? "matching " : ""}milestones` : "";
  ui["hero-list"].replaceChildren(...(selected ? [renderHero(selected, matchingGoals)] : []));
  if (goalScroll) {
    const grid = ui["hero-list"].querySelector(".goal-grid");
    grid.scrollTop = goalScroll.top;
    grid.scrollLeft = goalScroll.left;
  }
  if (!selected) renderHeroMap(filtered);
  ui["empty-state"].hidden = !selected || Boolean(state.goalId) || filtered.length > 0;
  ui["expand-all"].disabled = !selectedGoal?.milestones.length;
  ui["collapse-all"].disabled = !selectedGoal?.milestones.length;
  syncSelections();
}

function resetFilters() {
  state.query = "";
  state.status = "all";
  ui.search.value = "";
  ui["status-filter"].value = "all";
  renderNavigation();
  renderHeroes();
}

function loadIncludedRecord() {
  ui["load-error"].hidden = true;
  ui.dashboard.hidden = true;
  try {
    const record = window.NonVerbaDashboardRecord;
    if (!record || typeof record !== "object") throw new Error("The included project record is missing.");
    validateProject(record.manifest, record.heroes);
    state.heroes = record.heroes;
    state.milestoneIndex = new Map(flattenMilestones(state.heroes).map((entry) => [entry.milestone.id, entry]));
    renderOverview();
    renderFocus();
    renderNavigation();
    renderHeroes();
    ui["file-source"].textContent = "Maintained project record";
    ui.dashboard.hidden = false;
  } catch (error) {
    ui["error-message"].textContent = error instanceof Error ? error.message : String(error);
    ui["load-error"].hidden = false;
    ui["updated-at"].textContent = "Project record unavailable";
    ui["file-source"].textContent = "The included project record needs attention.";
    const skipLink = document.querySelector(".skip-link");
    skipLink.href = "#load-error";
    skipLink.textContent = "Skip to project record error";
  } finally {
    ui["load-state"].hidden = true;
    ui.refresh.disabled = false;
  }
}

ui.search.addEventListener("input", () => { state.query = ui.search.value; renderHeroes(); });
ui["status-filter"].addEventListener("change", () => { state.status = ui["status-filter"].value; renderHeroes(); });
ui.reset.addEventListener("click", resetFilters);
ui["empty-reset"].addEventListener("click", resetFilters);
ui["project-reset"].addEventListener("click", resetFilters);
document.querySelector(".overview-return").addEventListener("click", (event) => {
  event.preventDefault();
  showOverview();
});
ui.refresh.addEventListener("click", () => window.location.reload());
ui.retry.addEventListener("click", () => window.location.reload());
for (const [id, open] of [["expand-all", true], ["collapse-all", false]]) {
  ui[id].addEventListener("click", () => {
    if (open) for (const panel of ui["hero-list"].querySelectorAll(".milestones")) setGoalExpanded(panel.dataset.goalId, true);
    for (const details of ui["hero-list"].querySelectorAll("details.milestone")) {
      const milestoneId = details.id.slice("item-".length);
      if (open) state.openMilestones.add(milestoneId);
      else state.openMilestones.delete(milestoneId);
      details.open = open;
    }
  });
}
loadIncludedRecord();
