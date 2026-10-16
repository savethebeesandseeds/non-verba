// SPDX-License-Identifier: AGPL-3.0-only
// Preview state lives only in this document; role selection is not authentication.
const perspectives = Object.freeze({
  requester: {
    label: 'Requester perspective',
    title: 'Make the work clear.',
    description: 'The intended journey brings the request, exact agreement and review of the work together. Those connected steps are still being developed.'
  },
  operator: {
    label: 'Operator perspective',
    title: 'Know what you are agreeing to.',
    description: 'The intended journey brings finding work, reviewing its exact terms and recording the outcome together. Those connected steps are still being developed.'
  }
});
const choices = [...document.querySelectorAll('[data-role]')];
const detail = document.querySelector('#role-detail');
for (const choice of choices) {
  choice.addEventListener('click', () => {
    const perspective = perspectives[choice.dataset.role];
    if (!perspective) return;
    for (const button of choices) button.setAttribute('aria-pressed', String(button === choice));
    detail.querySelector('.eyebrow').textContent = perspective.label;
    detail.querySelector('h3').textContent = perspective.title;
    detail.querySelector('#role-detail-description').textContent = perspective.description;
  });
}
