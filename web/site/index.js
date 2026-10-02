// SPDX-License-Identifier: AGPL-3.0-only
const appButton = document.querySelector('.app-button');
const developmentDialog = document.querySelector('#development-dialog');
const closeButton = developmentDialog.querySelector('.dialog-close');

appButton.addEventListener('click', () => developmentDialog.showModal());
closeButton.addEventListener('click', () => developmentDialog.close());
