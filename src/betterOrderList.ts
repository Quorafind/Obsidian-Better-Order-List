import { Plugin } from 'obsidian';
import { enterPressPlugin } from "./line";

export default class MyPlugin extends Plugin {

	async onload() {
		this.app.workspace.onLayoutReady(()=>{
			this.registerEditorExtension(enterPressPlugin());
		})
	}

	onunload() {

	}

}
