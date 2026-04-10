/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/style.css';
import { registerThemingParticipant } from '../../platform/theme/common/themeService.js';
import { WORKBENCH_BACKGROUND, TITLE_BAR_ACTIVE_BACKGROUND } from '../common/theme.js';
import { isWeb, isIOS } from '../../base/common/platform.js';
import { createMetaElement } from '../../base/browser/dom.js';
import { isSafari, isStandalone } from '../../base/browser/browser.js';
import { selectionBackground } from '../../platform/theme/common/colorRegistry.js';
import { mainWindow } from '../../base/browser/window.js';

registerThemingParticipant((theme, collector) => {

	// Background (helps for subpixel-antialiasing on Windows)
	const workbenchBackground = WORKBENCH_BACKGROUND(theme);
	collector.addRule(`.monaco-workbench { background-color: ${workbenchBackground}; }`);

	// Selection (do NOT remove - https://github.com/microsoft/vscode/issues/169662)
	const windowSelectionBackground = theme.getColor(selectionBackground);
	if (windowSelectionBackground) {
		collector.addRule(`.monaco-workbench ::selection { background-color: ${windowSelectionBackground}; }`);
	}

	// Update <meta name="theme-color" content=""> based on selected theme
	if (isWeb) {
		const titleBackground = theme.getColor(TITLE_BAR_ACTIVE_BACKGROUND);
		if (titleBackground) {
			const metaElementId = 'monaco-workbench-meta-theme-color';
			// eslint-disable-next-line no-restricted-syntax
			let metaElement = mainWindow.document.getElementById(metaElementId) as HTMLMetaElement | null;
			if (!metaElement) {
				metaElement = createMetaElement();
				metaElement.name = 'theme-color';
				metaElement.id = metaElementId;
			}

			metaElement.content = titleBackground.toString();
		}
	}

	// We disable user select on the root element, however on Safari this seems
	// to prevent any text selection in the monaco editor. As a workaround we
	// allow to select text in monaco editor instances.
	if (isSafari) {
		collector.addRule(`
			body.web {
				touch-action: none;
			}
			.monaco-workbench .monaco-editor .view-lines {
				user-select: text;
				-webkit-user-select: text;
			}
		`);
	}

	// Update body background color to ensure the home indicator area looks similar to the workbench
	if (isIOS && isStandalone()) {
		collector.addRule(`body { background-color: ${workbenchBackground}; }`);
	}

	// -------------------------------------------------------------
	// COLLABRIX GLOBAL AESTHETICS OVERRIDE
	// -------------------------------------------------------------
	collector.addRule(`
		/* Modern Rounded Tabs */
		.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab {
			border-radius: 8px 8px 0 0 !important;
			margin: 6px 4px 0 4px !important;
			border: 1px solid rgba(255,255,255,0.05) !important;
			border-bottom: none !important;
		}

		/* Hide the default underline on tabs */
		.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active {
			box-shadow: none !important;
		}

		/* Floating, Modern Command Palette */
		.quick-input-widget {
			border-radius: 16px !important;
			box-shadow: 0 24px 48px rgba(0,0,0,0.5) !important;
			border: 1px solid rgba(255,255,255,0.1) !important;
			overflow: hidden;
			background: var(--vscode-editor-background) !important;
		}

		/* Custom Activity Bar Badges */
		.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .badge .badge-content {
			border-radius: 4px !important;
			font-weight: 800 !important;
			box-shadow: 0 0 8px rgba(126, 87, 194, 0.8) !important;
		}

		/* Custom scrollbars */
		.monaco-scrollable-element > .scrollbar > .slider {
			border-radius: 10px !important;
		}

		/* Global UI Font Override to feel like a modern web app */
		.mac, .windows, .linux {
			font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
		}

		/* Clean up the Activity Bar */
		.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.checked .active-item-indicator:before {
			border-left: 3px solid #7e57c2 !important;
			border-top: none !important;
			border-bottom: none !important;
			border-right: none !important;
			height: 60% !important;
			top: 20% !important;
			border-radius: 4px !important;
		}

		/* Modern Dialog Windows */
		.monaco-dialog-box {
			border-radius: 12px !important;
			box-shadow: 0 16px 32px rgba(0,0,0,0.6) !important;
			border: 1px solid rgba(255,255,255,0.05) !important;
		}
	`);
});
