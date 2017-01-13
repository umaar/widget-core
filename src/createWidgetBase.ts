import { isComposeFactory } from '@dojo/compose/compose';
import createStateful from '@dojo/compose/bases/createStateful';
import {
	DNode,
	PropertiesChangeEvent,
	WNode,
	Widget,
	WidgetMixin,
	WidgetState,
	WidgetOptions,
	WidgetProperties,
	WidgetBaseFactory,
	FactoryRegistryItem
} from './interfaces';
import { VNode, VNodeProperties } from '@dojo/interfaces/vdom';
import { assign } from '@dojo/core/lang';
import WeakMap from '@dojo/shim/WeakMap';
import Promise from '@dojo/shim/Promise';
import Map from '@dojo/shim/Map';
import { v, registry } from './d';
import FactoryRegistry from './FactoryRegistry';
import shallowPropertyComparisonMixin from './mixins/shallowPropertyComparisonMixin';

interface WidgetInternalState {
	children: DNode[];
	dirty: boolean;
	widgetClasses: string[];
	cachedVNode?: VNode | string;
	factoryRegistry: FactoryRegistry;
	initializedFactoryMap: Map<string, Promise<WidgetBaseFactory>>;
	previousProperties: WidgetProperties;
	historicChildrenMap: Map<string | Promise<WidgetBaseFactory> | WidgetBaseFactory, Widget<WidgetProperties>>;
	currentChildrenMap: Map<string | Promise<WidgetBaseFactory> | WidgetBaseFactory, Widget<WidgetProperties>>;
};

/**
 * Internal state map for widget instances
 */
const widgetInternalStateMap = new WeakMap<Widget<WidgetProperties>, WidgetInternalState>();

function isWNode(child: DNode): child is WNode {
	return Boolean(child && (<WNode> child).factory !== undefined);
}

function getFromRegistry(instance: Widget<WidgetProperties>, factoryLabel: string): FactoryRegistryItem | null {
	if (instance.registry.has(factoryLabel)) {
		return instance.registry.get(factoryLabel);
	}

	return registry.get(factoryLabel);
}

function dNodeToVNode(instance: Widget<WidgetProperties>, dNode: DNode): VNode | string | null {
	const internalState = widgetInternalStateMap.get(instance);

	if (typeof dNode === 'string' || dNode === null) {
		return dNode;
	}

	if (isWNode(dNode)) {
		const { children, properties } = dNode;
		const { id } = properties;

		let { factory } = dNode;
		let child: Widget<WidgetProperties>;

		if (typeof factory === 'string') {
			const item = getFromRegistry(instance, factory);

			if (isComposeFactory(item)) {
				factory = <WidgetBaseFactory> item;
			}
			else {
				if (item && !internalState.initializedFactoryMap.has(factory)) {
					const promise = (<Promise<WidgetBaseFactory>> item).then((factory) => {
						instance.invalidate();
						return factory;
					});
					internalState.initializedFactoryMap.set(factory, promise);
				}
				return null;
			}
		}

		const childrenMapKey = id || factory;
		const cachedChild = internalState.historicChildrenMap.get(childrenMapKey);

		if (cachedChild) {
			child = cachedChild;
			if (properties) {
				child.setProperties(properties);
			}
		}
		else {
			child = factory({ properties });
			child.own(child.on('invalidated', () => {
				instance.invalidate();
			}));
			internalState.historicChildrenMap.set(childrenMapKey, child);
			instance.own(child);
		}
		if (!id && internalState.currentChildrenMap.has(factory)) {
			const errorMsg = 'must provide unique keys when using the same widget factory multiple times';
			console.error(errorMsg);
			instance.emit({ type: 'error', target: instance, error: new Error(errorMsg) });
		}

		child.children = children;
		internalState.currentChildrenMap.set(childrenMapKey, child);

		return child.__render__();
	}

	dNode.children = dNode.children
		.filter((child) => child !== null)
		.map((child: DNode) => {
			return dNodeToVNode(instance, child);
		});

	return dNode.render({ bind: instance });
}

function manageDetachedChildren(instance: Widget<WidgetProperties>): void {
	const internalState = widgetInternalStateMap.get(instance);

	internalState.historicChildrenMap.forEach((child, key) => {
		if (!internalState.currentChildrenMap.has(key)) {
			internalState.historicChildrenMap.delete(key);
			child.destroy();
		}
	});
	internalState.currentChildrenMap.clear();
}

function formatTagNameAndClasses(tagName: string, classes: string[]) {
	if (classes.length) {
		return `${tagName}.${classes.join('.')}`;
	}
	return tagName;
}

const createWidget: WidgetBaseFactory = createStateful
	.mixin<WidgetMixin<WidgetProperties>, WidgetOptions<WidgetState, WidgetProperties>>({
		mixin: {
			properties: {},

			classes: [],

			getNode(): DNode {
				const tag = formatTagNameAndClasses(this.tagName, this.classes);
				return v(tag, this.getNodeAttributes(), this.getChildrenNodes());
			},

			set children(this: Widget<WidgetProperties>, children: DNode[]) {
				const internalState = widgetInternalStateMap.get(this);
				internalState.children = children;
				this.emit({
					type: 'widget:children',
					target: this
				});
			},

			get children() {
				return widgetInternalStateMap.get(this).children;
			},

			getChildrenNodes(this: Widget<WidgetProperties>): DNode[] {
				return this.children;
			},

			getNodeAttributes(this: Widget<WidgetProperties>, overrides?: VNodeProperties): VNodeProperties {
				const props: VNodeProperties = {};

				this.nodeAttributes.forEach((fn) => {
					const newProps: VNodeProperties = fn.call(this);
					if (newProps) {
						assign(props, newProps);
					}
				});

				return props;
			},

			invalidate(this: Widget<WidgetProperties>): void {
				const internalState = widgetInternalStateMap.get(this);
				internalState.dirty = true;
				this.emit({
					type: 'invalidated',
					target: this
				});
			},

			get id(this: Widget<WidgetProperties>): string | undefined {
				return this.properties.id;
			},

			setProperties(this: Widget<WidgetProperties>, properties: WidgetProperties) {
				const internalState = widgetInternalStateMap.get(this);
				const changedPropertyKeys = this.diffProperties(internalState.previousProperties, properties);
				this.properties = this.assignProperties(internalState.previousProperties, properties, changedPropertyKeys);
				if (changedPropertyKeys.length) {
					this.emit({
						type: 'properties:changed',
						target: this,
						properties: this.properties,
						changedPropertyKeys
					});
				}
				internalState.previousProperties = this.properties;
			},

			diffProperties(this: Widget<WidgetProperties>, previousProperties: WidgetProperties, newProperties: WidgetProperties): string[] {
				return Object.keys(newProperties);
			},

			assignProperties(this: Widget<WidgetProperties>, previousProperties: WidgetProperties, newProperties: WidgetProperties, changedPropertyKeys: string[]): WidgetProperties {
				return assign({}, newProperties);
			},

			onPropertiesChanged: function(this: Widget<WidgetProperties>, properties: WidgetProperties, changedPropertyKeys: string[]): void {
				const state = changedPropertyKeys.reduce((state: any, key) => {
					const property = (<any> properties)[key];
					if (!(typeof property === 'function')) {
						state[key] = property;
					}
					return state;
				}, {});
				this.setState(state);
			},

			nodeAttributes: [
				function (this: Widget<WidgetProperties>): VNodeProperties {
					const baseIdProp = this.state && this.state.id ? { 'data-widget-id': this.state.id } : {};
					const { styles = {} } = this.state || {};
					const classes: { [index: string]: boolean; } = {};

					const internalState = widgetInternalStateMap.get(this);

					internalState.widgetClasses.forEach((c) => classes[c] = false);

					if (this.state && this.state.classes) {
						this.state.classes.forEach((c) => classes[c] = true);
						internalState.widgetClasses =  this.state.classes;
					}

					return assign(baseIdProp, { key: this, classes, styles });
				}
			],

			__render__(this: Widget<WidgetProperties>): VNode | string | null {
				const internalState = widgetInternalStateMap.get(this);
				if (internalState.dirty || !internalState.cachedVNode) {
					const widget = dNodeToVNode(this, this.getNode());
					manageDetachedChildren(this);
					if (widget) {
						internalState.cachedVNode = widget;
					}
					internalState.dirty = false;
					return widget;
				}
				return internalState.cachedVNode;
			},

			get registry(this: Widget<WidgetProperties>): FactoryRegistry {
				return widgetInternalStateMap.get(this).factoryRegistry;
			},

			tagName: 'div'
		},
		initialize(instance: Widget<WidgetProperties>, options: WidgetOptions<WidgetState, WidgetProperties> = {}) {
			const { tagName, properties = {} } = options;

			instance.tagName = tagName || instance.tagName;

			widgetInternalStateMap.set(instance, {
				dirty: true,
				widgetClasses: [],
				previousProperties: {},
				factoryRegistry: new FactoryRegistry(),
				initializedFactoryMap: new Map<string, Promise<WidgetBaseFactory>>(),
				historicChildrenMap: new Map<string | Promise<WidgetBaseFactory> | WidgetBaseFactory, Widget<WidgetProperties>>(),
				currentChildrenMap: new Map<string | Promise<WidgetBaseFactory> | WidgetBaseFactory, Widget<WidgetProperties>>(),
				children: []
			});

			instance.own(instance.on('properties:changed', (evt: PropertiesChangeEvent<Widget<WidgetProperties>, WidgetProperties>) => {
				instance.onPropertiesChanged(evt.properties, evt.changedPropertyKeys);
			}));

			instance.own(instance.on('state:changed', () => {
				instance.invalidate();
			}));

			instance.setProperties(properties);
		}
	})
	.mixin(shallowPropertyComparisonMixin);

export default createWidget;