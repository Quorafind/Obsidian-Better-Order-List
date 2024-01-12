import { Plugin } from 'obsidian';
import { enterPressPlugin } from "./line";

export default class BetterOrderListPlugin extends Plugin {

	async onload() {
		this.app.workspace.onLayoutReady(() => {
			this.registerEditorExtension(enterPressPlugin());
		});
	}

	onunload() {

	}

}
