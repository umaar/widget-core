import { DNode } from '../../../src/interfaces';
import { WidgetBase } from '../../../src/WidgetBase';
import { v, w } from '../../../src/d';

import { Button } from './Button';

export interface ButtonConfig {
	id: string;
	label: string;
	onClick: () => void;
}

export interface ButtonsProperties {
	buttonConfigs: ButtonConfig[];
}

export class Buttons extends WidgetBase<ButtonsProperties> {
	protected render(): DNode {
		const { buttonConfigs } = this.properties;

		return v('div', { classes: ['jumbotron'] }, [
			v('div', { classes: ['row'] }, [
				v('div', { classes: ['col-md-6'] }, [v('h1', ['Dojo2 v0.2.0'])]),
				v(
					'div',
					{ classes: ['col-md-6'] },
					buttonConfigs.map(({ id, label, onClick }) => {
						return w(Button, { key: id, id, label, onClick });
					})
				)
			])
		]);
	}
}
