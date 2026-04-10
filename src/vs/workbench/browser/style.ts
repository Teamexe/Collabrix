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
	// COLLABRIX NOVA/FLEET GLOBAL AESTHETICS OVERRIDE
	// -------------------------------------------------------------
	collector.addRule(`
		/* The Deep Space-to-Neon Gradient Wallpaper */
		.monaco-workbench {
			background: radial-gradient(circle at 10% 10%, #15002b 0%, #0d001a 40%, #000000 100%) !important;
		}

		/* 
		   FLEET/NOVA Layout Grid Hack 
		   Stop VS Code from strictly pinning panels to edges.
		   We use a padding-based layout so floating glass panels don't overlap boundaries!
		*/
		.monaco-workbench .part.activitybar {
			box-sizing: border-box !important;
			padding: 10px !important;
			background: transparent !important;
		}
		
		/* The Floating Activity Bar Capsule */
		.monaco-workbench .activitybar > .content {
			background: rgba(25, 10, 40, 0.4) !important;
			backdrop-filter: blur(20px) !important;
			border-radius: 20px !important;
			border: 1px solid rgba(255, 255, 255, 0.08) !important;
			box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5) !important;
		}

		/* The Floating Side Bar (Explorer) */
		.monaco-workbench .part.sidebar {
			box-sizing: border-box !important;
			padding: 10px 10px 10px 0 !important;
			background: transparent !important;
		}
		
		.monaco-workbench .part.sidebar > .content {
			background: rgba(15, 5, 25, 0.6) !important;
			backdrop-filter: blur(15px) !important;
			border-radius: 12px !important;
			border: 1px solid rgba(255, 255, 255, 0.05) !important;
		}

		/* The Floating Editor Area */
		.monaco-workbench .part.editor {
			box-sizing: border-box !important;
			padding: 10px 10px 10px 0 !important;
			background: transparent !important;
		}

		.monaco-workbench .part.editor > .content {
			background: rgba(10, 0, 20, 0.6) !important;
			backdrop-filter: blur(10px) !important;
			border-radius: 12px !important;
			border: 1px solid rgba(255, 255, 255, 0.05) !important;
			overflow: hidden !important;
		}

		/* The Floating Status Bar Pill */
		.monaco-workbench .part.statusbar {
			box-sizing: border-box !important;
			padding: 0 20px 10px 20px !important;
			background: transparent !important;
		}

		.monaco-workbench .part.statusbar > .items-container {
			background: rgba(20, 5, 35, 0.8) !important;
			backdrop-filter: blur(15px) !important;
			border-radius: 20px !important;
			border: 1px solid rgba(255, 255, 255, 0.08) !important;
			padding: 0 15px !important;
		}

		/* High-Gloss Vibrant Pill Tabs */
		.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab {
			border-radius: 20px !important;
			margin: 8px 4px !important;
			background: rgba(255, 255, 255, 0.03) !important;
			border: 1px solid rgba(255, 255, 255, 0.05) !important;
			height: 28px !important;
			transition: all 0.2s ease !important;
		}

		.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active {
			background: linear-gradient(135deg, rgba(126, 87, 194, 0.6), rgba(81, 45, 168, 0.6)) !important;
			border-color: rgba(126, 87, 194, 0.8) !important;
			box-shadow: 0 4px 12px rgba(126, 87, 194, 0.3) !important;
		}

		/* Hide the default underline on tabs */
		.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab::after {
			display: none !important;
		}

		/* Floating, Modern Command Palette */
		.quick-input-widget {
			border-radius: 16px !important;
			box-shadow: 0 24px 48px rgba(0,0,0,0.5) !important;
			border: 1px solid rgba(255,255,255,0.1) !important;
			background: rgba(25, 10, 40, 0.9) !important;
			backdrop-filter: blur(25px) !important;
		}
	`);
});
