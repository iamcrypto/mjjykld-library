import { ILocalizableOwner, LocalizableString } from "./localizablestring";
import { Helpers, HashTable } from "./helpers";
import {
  CustomPropertiesCollection,
  JsonObject,
  JsonObjectProperty,
  Serializer,
} from "./jsonobject";
import { settings } from "./settings";
import { ItemValue } from "./itemvalue";
import { IFindElement, IProgressInfo, ISurvey } from "./base-interfaces";
import { ExpressionRunner } from "./conditions";
import { surveyLocalization } from "./surveyStrings";

interface IExpressionRunnerInfo {
  onExecute: (obj: Base, res: any) => void;
  canRun?: (obj: Base) => boolean;
  runner?: ExpressionRunner;
}

export class Bindings {
  private properties: Array<JsonObjectProperty> = null;
  private values: any = null;
  constructor(private obj: Base) { }
  public getType(): string {
    return "bindings";
  }
  public getNames(): Array<string> {
    var res: Array<string> = [];
    this.fillProperties();
    for (var i = 0; i < this.properties.length; i++) {
      if (this.properties[i].isVisible("", this.obj)) {
        res.push(this.properties[i].name);
      }
    }
    return res;
  }
  public getProperties(): Array<JsonObjectProperty> {
    var res: Array<JsonObjectProperty> = [];
    this.fillProperties();
    for (var i = 0; i < this.properties.length; i++) {
      res.push(this.properties[i]);
    }
    return res;
  }
  public setBinding(propertyName: string, valueName: string) {
    if (!this.values) this.values = {};
    const oldValue = this.getJson();
    if(oldValue === valueName) return;
    if (!!valueName) {
      this.values[propertyName] = valueName;
    } else {
      delete this.values[propertyName];
      if (Object.keys(this.values).length == 0) {
        this.values = null;
      }
    }
    this.onChangedJSON(oldValue);
  }
  public clearBinding(propertyName: string) {
    this.setBinding(propertyName, "");
  }
  public isEmpty(): boolean {
    if(!this.values) return true;
    for(var key in this.values) return false;
    return true;
  }
  public getValueNameByPropertyName(propertyName: string): string {
    if (!this.values) return undefined;
    return this.values[propertyName];
  }
  public getPropertiesByValueName(valueName: string): Array<string> {
    if (!this.values) return [];
    var res: Array<string> = [];
    for (var key in this.values) {
      if (this.values[key] == valueName) {
        res.push(key);
      }
    }
    return res;
  }
  public getJson(): any {
    if (this.isEmpty()) return undefined;
    var res: any = {};
    for (var key in this.values) {
      res[key] = this.values[key];
    }
    return res;
  }
  public setJson(value: any) {
    const oldValue = this.getJson();
    this.values = null;
    if (!!value) {
      this.values = {};
      for (var key in value) {
        this.values[key] = value[key];
      }
    }
    this.onChangedJSON(oldValue);
  }
  private fillProperties() {
    if (this.properties !== null) return;
    this.properties = [];
    var objProperties = Serializer.getPropertiesByObj(this.obj);
    for (var i = 0; i < objProperties.length; i++) {
      if (objProperties[i].isBindable) {
        this.properties.push(objProperties[i]);
      }
    }
  }
  private onChangedJSON(oldValue: any): void {
    if(this.obj) {
      this.obj.onBindingChanged(oldValue, this.getJson());
    }
  }
}

export class Dependencies {
  private static DependenciesCount = 0;
  constructor(public currentDependency: () => void, public target: Base, public property: string) {
  }
  dependencies: Array<{ obj: Base, prop: string, id: string }> = [];
  id: string = "" + (++Dependencies.DependenciesCount);
  addDependency(target: Base, property: string): void {
    if (this.target === target && this.property === property)
      return;
    if (this.dependencies.some(dependency => dependency.obj === target && dependency.prop === property))
      return;

    this.dependencies.push({
      obj: target,
      prop: property,
      id: this.id
    });
    target.registerFunctionOnPropertiesValueChanged([property], this.currentDependency, this.id);

  }
  dispose(): void {
    this.dependencies.forEach(dependency => {
      dependency.obj.unRegisterFunctionOnPropertiesValueChanged([dependency.prop], dependency.id);
    });
  }
}

export class ComputedUpdater<T = any> {
  public static readonly ComputedUpdaterType = "__dependency_computed";
  private dependencies: Dependencies = undefined;
  constructor(private _updater: () => T) {
  }
  readonly type = ComputedUpdater.ComputedUpdaterType;
  public get updater(): () => T {
    return this._updater;
  }
  public setDependencies(dependencies: Dependencies): void {
    this.clearDependencies();
    this.dependencies = dependencies;
  }
  protected getDependencies(): Dependencies {
    return this.dependencies;
  }
  private clearDependencies() {
    if (this.dependencies) {
      this.dependencies.dispose();
      this.dependencies = undefined;
    }
  }
  dispose(): any {
    this.clearDependencies();
  }
}

/**
 * A base class for all SurveyJS objects.
 */
export class Base {
  private static currentDependencis: Dependencies = undefined;
  public static finishCollectDependencies(): Dependencies {
    const deps = Base.currentDependencis;
    Base.currentDependencis = undefined;
    return deps;
  }
  public static startCollectDependencies(updater: () => void, target: Base, property: string): void {
    if (Base.currentDependencis !== undefined) {
      throw new Error("Attempt to collect nested dependencies. Nested dependencies are not supported.");
    }
    Base.currentDependencis = new Dependencies(updater, target, property);
  }
  private static collectDependency(target: Base, property: string): void {
    if (Base.currentDependencis === undefined) return;
    Base.currentDependencis.addDependency(target, property);
  }
  public static get commentPrefix(): string {
    return settings.commentPrefix;
  }
  public static set commentPrefix(val: string) {
    settings.commentPrefix = val;
  }
  public static createItemValue: (item: any, type?: string) => any;
  public static itemValueLocStrChanged: (arr: Array<any>) => void;
  /**
   * Returns `true` if a passed `value` is an empty string, array, or object or if it equals to `undefined` or `null`.
   *
   * @param value A value to be checked.
   * @param trimString (Optional) When this parameter is `true`, the method ignores whitespace characters at the beginning and end of a string value. Pass `false` to disable this functionality.
   */
  public isValueEmpty(value: any, trimString: boolean = true): boolean {
    if (trimString) {
      value = this.trimValue(value);
    }
    return Helpers.isValueEmpty(value);
  }
  protected trimValue(value: any): any {
    if (!!value && (typeof value === "string" || value instanceof String))
      return value.trim();
    return value;
  }
  protected isPropertyEmpty(value: any): boolean {
    return value !== "" && this.isValueEmpty(value);
  }

  private propertyHash: { [index: string]: any } = {};
  private localizableStrings: { [index: string]: LocalizableString };
  private arraysInfo: { [index: string]: any };
  private eventList: Array<EventBase<any>> = [];
  private expressionInfo: { [index: string]: IExpressionRunnerInfo };
  private bindingsValue: Bindings;
  private isDisposedValue: boolean;
  private onPropChangeFunctions: Array<{
    name: string,
    func: (...args: any[]) => void,
    key: string,
  }>;
  protected isLoadingFromJsonValue: boolean = false;
  public loadingOwner: Base = null;
  /**
   * An event that is raised when a property of this SurveyJS object has changed.
   *
   * Parameters:
   *
   * - `sender` - A SurveyJS object whose property has changed.
   * - `options.name` - The name of the changed property.
   * - `options.oldValue` - An old value of the property. If the property is an array, `oldValue` contains the same array as `newValue` does.
   * - `options.newValue` - A new value for the property.
   */
  public onPropertyChanged: EventBase<Base> = this.addEvent<Base>();
  /**
   * An event that is raised when an [ItemValue](https://surveyjs.io/form-library/documentation/itemvalue) property is changed.
   *
   * Parameters:
   *
   * - `sender` - A SurveyJS object whose property contains an array of `ItemValue` objects.
   * - `options.obj` - An `ItemValue` object.
   * - `options.propertyName` - The name of the property to which an array of `ItemValue` objects is assigned (for example, `"choices"` or `"rows"`).
   * - `options.name` - The name of the changed property: `"text"` or `"value"`.
   * - `options.newValue` - A new value for the property.
   */
  public onItemValuePropertyChanged: Event<
    (sender: Base, options: any) => any,
    any
  > = this.addEvent<Base>();

  getPropertyValueCoreHandler: (propertiesHash: any, name: string) => any;

  setPropertyValueCoreHandler: (
    propertiesHash: any,
    name: string,
    val: any
  ) => void;
  createArrayCoreHandler: (propertiesHash: any, name: string) => Array<any>;
  surveyChangedCallback: () => void;

  private isCreating = true;

  public constructor() {
    this.bindingsValue = new Bindings(this);
    CustomPropertiesCollection.createProperties(this);
    this.onBaseCreating();
    this.isCreating = false;
  }
  public dispose() {
    for (var i = 0; i < this.eventList.length; i++) {
      this.eventList[i].clear();
    }
    this.onPropertyValueChangedCallback = undefined;
    this.isDisposedValue = true;
  }
  public get isDisposed() {
    return this.isDisposedValue === true;
  }
  protected addEvent<T>(): EventBase<T> {
    var res = new EventBase<T>();
    this.eventList.push(res);
    return res;
  }
  protected onBaseCreating() { }
  /**
   * Returns the object type as it is used in the JSON schema.
   */
  public getType(): string {
    return "base";
  }
  /**
   * Use this method to find out if the current object is of a given `typeName` or inherited from it.
   *
   * @param typeName One of the values listed in the [getType()](https://surveyjs.io/form-library/documentation/question#getType) description.
   * @returns `true` if the current object is of a given `typeName` or inherited from it.
   * @see getType
   */
  public isDescendantOf(typeName: string): boolean {
    return Serializer.isDescendantOf(this.getType(), typeName);
  }
  public getSurvey(isLive: boolean = false): ISurvey {
    return null;
  }
  /**
   * Returns `true` if the survey is being designed in Survey Creator.
   */
  public get isDesignMode(): boolean {
    const survey = this.getSurvey();
    return !!survey && survey.isDesignMode;
  }
  /**
   * Returns `true` if the object is included in a survey.
   *
   * This property may return `false`, for example, when you [create a survey model dynamically](https://surveyjs.io/form-library/documentation/design-survey-create-a-simple-survey#create-or-change-a-survey-model-dynamically).
   */
  public get inSurvey(): boolean {
    return !!this.getSurvey(true);
  }
  public get bindings(): Bindings {
    return this.bindingsValue;
  }
  checkBindings(valueName: string, value: any) { }
  protected updateBindings(propertyName: string, value: any) {
    var valueName = this.bindings.getValueNameByPropertyName(propertyName);
    if (!!valueName) {
      this.updateBindingValue(valueName, value);
    }
  }
  protected updateBindingValue(valueName: string, value: any) { }
  public getTemplate(): string {
    return this.getType();
  }
  /**
   * Returns `true` if the object configuration is being loaded from JSON.
   */
  public get isLoadingFromJson(): boolean {
    return this.isLoadingFromJsonValue || this.getIsLoadingFromJson();
  }
  protected getIsLoadingFromJson(): boolean {
    if (!!this.loadingOwner && this.loadingOwner.isLoadingFromJson) return true;
    return this.isLoadingFromJsonValue;
  }

  startLoadingFromJson(json?: any) {
    this.isLoadingFromJsonValue = true;
  }
  endLoadingFromJson() {
    this.isLoadingFromJsonValue = false;
  }
  /**
   * Returns a JSON object that corresponds to the current SurveyJS object.
   * @see fromJSON
   */
  public toJSON(): any {
    return new JsonObject().toJsonObject(this);
  }
  /**
   * Assigns a new configuration to the current SurveyJS object. This configuration is taken from a passed JSON object.
   *
   * The JSON object should contain only serializable properties of this SurveyJS object. Event handlers and properties that do not belong to the SurveyJS object are ignored.
   *
   * @param json A JSON object with properties that you want to apply to the current SurveyJS object.
   * @see toJSON
   */
  public fromJSON(json: any): void {
    new JsonObject().toObject(json, this);
    this.onSurveyLoad();
  }
  public onSurveyLoad() { }
  /**
   * Creates a new object that has the same type and properties as the current SurveyJS object.
   */
  public clone(): Base {
    var clonedObj = <Base>Serializer.createClass(this.getType());
    clonedObj.fromJSON(this.toJSON());
    return clonedObj;
  }
  /**
   * Returns a `JsonObjectProperty` object with metadata about a serializable property that belongs to the current SurveyJS object.
   *
   * If the property is not found, this method returns `null`.
   * @param propName A property name.
   */
  public getPropertyByName(propName: string): JsonObjectProperty {
    return Serializer.findProperty(this.getType(), propName);
  }
  public isPropertyVisible(propName: string): boolean {
    const prop = this.getPropertyByName(propName);
    return !!prop ? prop.isVisible("", this) : false;
  }
  public static createProgressInfo(): IProgressInfo {
    return {
      questionCount: 0,
      answeredQuestionCount: 0,
      requiredQuestionCount: 0,
      requiredAnsweredQuestionCount: 0,
    };
  }
  public getProgressInfo(): IProgressInfo {
    return Base.createProgressInfo();
  }
  public localeChanged() { }
  public locStrsChanged() {
    if (!!this.arraysInfo) {
      for (let key in this.arraysInfo) {
        let item = this.arraysInfo[key];
        if (item && item.isItemValues) {
          var arr = this.getPropertyValue(key);
          if (arr && !!Base.itemValueLocStrChanged)
            Base.itemValueLocStrChanged(arr);
        }
      }
    }
    if (!!this.localizableStrings) {
      for (let key in this.localizableStrings) {
        let item = this.getLocalizableString(key);
        if (item) item.strChanged();
      }
    }
  }
  /**
   * Returns the value of a property with a specified name.
   *
   * If the property is not found or does not have a value, this method returns either `undefined`, `defaultValue` specified in the property configuration, or a value passed as the `defaultValue` parameter.
   *
   * @param name A property name.
   * @param defaultValue (Optional) A value to return if the property is not found or does not have a value.
   */
  public getPropertyValue(name: string, defaultValue: any = null): any {
    const res = this.getPropertyValueCore(this.propertyHash, name);
    if (this.isPropertyEmpty(res)) {
      if (defaultValue != null) return defaultValue;
      const prop = Serializer.findProperty(this.getType(), name);
      if (!!prop && (!prop.isCustom || !this.isCreating)) {
        if (
          !this.isPropertyEmpty(prop.defaultValue) &&
          !Array.isArray(prop.defaultValue)
        )
          return prop.defaultValue;
        if (prop.type == "boolean" || prop.type == "switch") return false;
        if (prop.isCustom && !!prop.onGetValue) return prop.onGetValue(this);
      }
    }
    return res;
  }
  protected getPropertyValueCore(propertiesHash: any, name: string) {
    Base.collectDependency(this, name);
    if (this.getPropertyValueCoreHandler)
      return this.getPropertyValueCoreHandler(propertiesHash, name);
    else return propertiesHash[name];
  }
  public geValueFromHash(): any {
    return this.propertyHash["value"];
  }
  protected setPropertyValueCore(propertiesHash: any, name: string, val: any) {
    if (this.setPropertyValueCoreHandler) {
      if (!this.isDisposedValue) {
        this.setPropertyValueCoreHandler(propertiesHash, name, val);
      } else {
        // eslint-disable-next-line no-console
        console.warn("Attempt to set property '" + name + "' of a disposed object '" + this.getType() + "'");
      }
    }
    else propertiesHash[name] = val;
  }
  public get isEditingSurveyElement(): boolean {
    var survey = this.getSurvey();
    return !!survey && survey.isEditingSurveyElement;
  }
  public iteratePropertiesHash(func: (hash: any, key: any) => void) {
    var keys: any[] = [];
    for (var key in this.propertyHash) {
      if (
        key === "value" &&
        this.isEditingSurveyElement &&
        Array.isArray((<any>this).value)
      )
        continue;

      keys.push(key);
    }
    keys.forEach((key) => func(this.propertyHash, key));
  }
  /**
   * Assigns a new value to a specified property.
   * @param name A property name.
   * @param val A new value for the property.
   */
  public setPropertyValue(name: string, val: any): void {
    if(!this.isLoadingFromJson) {
      const prop = this.getPropertyByName(name);
      if(!!prop) {
        val = prop.settingValue(this, val);
      }
    }
    var oldValue = this.getPropertyValue(name);
    if (
      oldValue &&
      Array.isArray(oldValue) &&
      !!this.arraysInfo &&
      (!val || Array.isArray(val))
    ) {
      if (this.isTwoValueEquals(oldValue, val)) return;
      this.setArrayPropertyDirectly(name, val);
    } else {
      this.setPropertyValueDirectly(name, val);
      if (!this.isDisposedValue && !this.isTwoValueEquals(oldValue, val)) {
        this.propertyValueChanged(name, oldValue, val);
      }
    }
  }
  protected setArrayPropertyDirectly(name: string, val: any, sendNotification: boolean = true): void {
    var arrayInfo = this.arraysInfo[name];
    this.setArray(
      name,
      this.getPropertyValue(name),
      val,
      arrayInfo ? arrayInfo.isItemValues : false,
      arrayInfo ? sendNotification && arrayInfo.onPush : null
    );
  }
  protected setPropertyValueDirectly(name: string, val: any) : void {
    this.setPropertyValueCore(this.propertyHash, name, val);
  }
  protected clearPropertyValue(name: string) {
    this.setPropertyValueCore(this.propertyHash, name, null);
    delete this.propertyHash[name];
  }
  public onPropertyValueChangedCallback(
    name: string,
    oldValue: any,
    newValue: any,
    sender: Base,
    arrayChanges: ArrayChanges
  ) { }
  public itemValuePropertyChanged(
    item: ItemValue,
    name: string,
    oldValue: any,
    newValue: any
  ) {
    this.onItemValuePropertyChanged.fire(this, {
      obj: item,
      name: name,
      oldValue: oldValue,
      newValue: newValue,
      propertyName: item.ownerPropertyName,
    });
  }
  protected onPropertyValueChanged(
    name: string,
    oldValue: any,
    newValue: any
  ) { }
  protected propertyValueChanged(
    name: string,
    oldValue: any,
    newValue: any,
    arrayChanges?: ArrayChanges,
    target?: Base
  ) {
    if (this.isLoadingFromJson) return;
    this.updateBindings(name, newValue);
    this.onPropertyValueChanged(name, oldValue, newValue);
    this.onPropertyChanged.fire(this, {
      name: name,
      oldValue: oldValue,
      newValue: newValue,
    });

    this.doPropertyValueChangedCallback(
      name,
      oldValue,
      newValue,
      arrayChanges,
      this
    );
    this.checkConditionPropertyChanged(name);
    if (!this.onPropChangeFunctions) return;
    for (var i = 0; i < this.onPropChangeFunctions.length; i++) {
      if (this.onPropChangeFunctions[i].name == name)
        this.onPropChangeFunctions[i].func(newValue);
    }
  }
  public onBindingChanged(oldValue: any, newValue: any): void {
    if(this.isLoadingFromJson) return;
    this.doPropertyValueChangedCallback("bindings", oldValue, newValue);
  }
  protected get isInternal(): boolean {
    return false;
  }
  private doPropertyValueChangedCallback(
    name: string,
    oldValue: any,
    newValue: any,
    arrayChanges?: ArrayChanges,
    target?: Base
  ) {
    if (this.isInternal) return;
    if (!target) target = this;
    var notifier: any = this.getSurvey();
    if (!notifier) notifier = this;
    if (!!notifier.onPropertyValueChangedCallback) {
      notifier.onPropertyValueChangedCallback(
        name,
        oldValue,
        newValue,
        target,
        arrayChanges
      );
    }
    if (notifier !== this && !!this.onPropertyValueChangedCallback) {
      this.onPropertyValueChangedCallback(
        name,
        oldValue,
        newValue,
        target,
        arrayChanges
      );
    }
  }
  public addExpressionProperty(name: string, onExecute: (obj: Base, res: any) => void, canRun?: (obj: Base) => boolean): void {
    if(!this.expressionInfo) {
      this.expressionInfo = {};
    }
    this.expressionInfo[name] = { onExecute: onExecute, canRun: canRun };
  }
  public getDataFilteredValues(): any {
    return {};
  }
  public getDataFilteredProperties(): any {
    return {};
  }
  protected runConditionCore(values: HashTable<any>, properties: HashTable<any>): void {
    if(!this.expressionInfo) return;
    for(var key in this.expressionInfo) {
      this.runConditionItemCore(key, values, properties);
    }
  }
  protected canRunConditions(): boolean {
    return !this.isDesignMode;
  }
  private checkConditionPropertyChanged(propName: string): void {
    if(!this.expressionInfo || !this.expressionInfo[propName]) return;
    if(!this.canRunConditions()) return;
    this.runConditionItemCore(propName, this.getDataFilteredValues(), this.getDataFilteredProperties());
  }
  private runConditionItemCore(propName: string, values: HashTable<any>, properties: HashTable<any>): void {
    const info = this.expressionInfo[propName];
    const expression = this.getPropertyValue(propName);
    if(!expression) return;
    if(!!info.canRun && !info.canRun(this)) return;
    if(!info.runner) {
      info.runner = new ExpressionRunner(expression);
      info.runner.onRunComplete = (res: any) => {
        info.onExecute(this, res);
      };
    }
    info.runner.expression = expression;
    info.runner.run(values, properties);
  }
  /**
   * Register a function that will be called on a property value changed.
   * @param name the property name
   * @param func the function with no parameters that will be called on property changed.
   * @param key an optional parameter. If there is already a registered function for this property with the same key, it will be overwritten.
   */
  public registerFunctionOnPropertyValueChanged(
    name: string,
    func: any,
    key: string = null
  ) {
    if (!this.onPropChangeFunctions) {
      this.onPropChangeFunctions = [];
    }
    if (key) {
      for (var i = 0; i < this.onPropChangeFunctions.length; i++) {
        var item = this.onPropChangeFunctions[i];
        if (item.name == name && item.key == key) {
          item.func = func;
          return;
        }
      }
    }
    this.onPropChangeFunctions.push({ name: name, func: func, key: key });
  }
  /**
   * Register a function that will be called on a property value changed from the names list.
   * @param names the list of properties names
   * @param func the function with no parameters that will be called on property changed.
   * @param key an optional parameter. If there is already a registered function for this property with the same key, it will be overwritten.
   */
  public registerFunctionOnPropertiesValueChanged(
    names: Array<string>,
    func: any,
    key: string = null
  ) {
    for (var i = 0; i < names.length; i++) {
      this.registerFunctionOnPropertyValueChanged(names[i], func, key);
    }
  }
  /**
   * Unregister notification on property value changed
   * @param name the property name
   * @param key the key with which you have registered the notification for this property. It can be null.
   */
  public unRegisterFunctionOnPropertyValueChanged(
    name: string,
    key: string = null
  ) {
    if (!this.onPropChangeFunctions) return;
    for (var i = 0; i < this.onPropChangeFunctions.length; i++) {
      var item = this.onPropChangeFunctions[i];
      if (item.name == name && item.key == key) {
        this.onPropChangeFunctions.splice(i, 1);
        return;
      }
    }
  }
  /**
   * Unregister notification on property value changed for all properties in the names list.
   * @param names the list of properties names
   * @param key the key with which you have registered the notification for this property. It can be null.
   */
  public unRegisterFunctionOnPropertiesValueChanged(
    names: Array<string>,
    key: string = null
  ) {
    for (var i = 0; i < names.length; i++) {
      this.unRegisterFunctionOnPropertyValueChanged(names[i], key);
    }
  }
  public createCustomLocalizableObj(name: string) {
    var locStr = this.getLocalizableString(name);
    if (locStr) return;
    this.createLocalizableString(name, <ILocalizableOwner>(<any>this), false, true);
  }
  public getLocale(): string {
    const locOwner = this.getSurvey();
    return !!locOwner ? locOwner.getLocale(): "";
  }
  public getLocalizationString(strName: string): string {
    return surveyLocalization.getString(strName, this.getLocale());
  }
  public getLocalizationFormatString(strName: string, ...args: any[]): string {
    const str: any = this.getLocalizationString(strName);
    if(!str || !str.format) return "";
    return str.format(...args);
  }
  protected createLocalizableString(
    name: string,
    owner: ILocalizableOwner,
    useMarkDown: boolean = false,
    defaultStr: boolean|string = false
  ): LocalizableString {
    var locStr = new LocalizableString(owner, useMarkDown, name);
    if (defaultStr) {
      locStr.localizationName = defaultStr === true ? name : defaultStr;
    }
    locStr.onStrChanged = (oldValue: string, newValue: string) => {
      this.propertyValueChanged(name, oldValue, newValue);
    };
    if (!this.localizableStrings) {
      this.localizableStrings = {};
    }
    this.localizableStrings[name] = locStr;
    return locStr;
  }
  public getLocalizableString(name: string): LocalizableString {
    return !!this.localizableStrings ? this.localizableStrings[name] : null;
  }
  public getLocalizableStringText(
    name: string,
    defaultStr: string = ""
  ): string {
    Base.collectDependency(this, name);
    var locStr = this.getLocalizableString(name);
    if (!locStr) return "";
    var res = locStr.text;
    return res ? res : defaultStr;
  }
  public setLocalizableStringText(name: string, value: string) {
    let locStr = this.getLocalizableString(name);
    if (!locStr) return;
    let oldValue = locStr.text;
    if(oldValue != value) {
      locStr.text = value;
      // this.propertyValueChanged(name, oldValue, value);
    }
  }
  public addUsedLocales(locales: Array<string>) {
    if (!!this.localizableStrings) {
      for (let key in this.localizableStrings) {
        let item = this.getLocalizableString(key);
        if (item) this.AddLocStringToUsedLocales(item, locales);
      }
    }
    if (!!this.arraysInfo) {
      for (let key in this.arraysInfo) {
        let items = this.getPropertyValue(key);
        if (!items || !items.length) continue;
        for (let i = 0; i < items.length; i++) {
          let item = items[i];
          if (item && item.addUsedLocales) {
            item.addUsedLocales(locales);
          }
        }
      }
    }
  }
  public searchText(text: string, founded: Array<IFindElement>) {
    var strs: Array<LocalizableString> = [];
    this.getSearchableLocalizedStrings(strs);
    for (var i = 0; i < strs.length; i++) {
      if (strs[i].setFindText(text)) {
        founded.push({ element: this, str: strs[i] });
      }
    }
  }
  private getSearchableLocalizedStrings(arr: Array<LocalizableString>) {
    if (!!this.localizableStrings) {
      let keys: Array<string> = [];
      this.getSearchableLocKeys(keys);
      for (var i = 0; i < keys.length; i++) {
        let item = this.getLocalizableString(keys[i]);
        if (item) arr.push(item);
      }
    }
    if (!this.arraysInfo) return;
    let keys: Array<string> = [];
    this.getSearchableItemValueKeys(keys);
    for (var i = 0; i < keys.length; i++) {
      var items = this.getPropertyValue(keys[i]);
      if (!items) continue;
      for (var j = 0; j < items.length; j++) {
        arr.push(items[j].locText);
      }
    }
  }
  protected getSearchableLocKeys(keys: Array<string>) { }
  protected getSearchableItemValueKeys(keys: Array<string>) { }
  protected AddLocStringToUsedLocales(
    locStr: LocalizableString,
    locales: Array<string>
  ) {
    var locs = locStr.getLocales();
    for (var i = 0; i < locs.length; i++) {
      if (locales.indexOf(locs[i]) < 0) {
        locales.push(locs[i]);
      }
    }
  }
  protected createItemValues(name: string): Array<any> {
    var self = this;
    var result = this.createNewArray(name, function (item: any) {
      item.locOwner = self;
      item.ownerPropertyName = name;
      if (typeof item.getSurvey == "function") {
        const survey: any = item.getSurvey();
        if (!!survey && typeof survey.makeReactive == "function") {
          survey.makeReactive(item);
        }
      }
    });
    this.arraysInfo[name].isItemValues = true;
    return result;
  }
  private notifyArrayChanged(ar: any, arrayChanges: ArrayChanges) {
    !!ar.onArrayChanged && ar.onArrayChanged(arrayChanges);
  }
  protected createNewArrayCore(name: string): Array<any> {
    var res = null;
    if (!!this.createArrayCoreHandler) {
      res = this.createArrayCoreHandler(this.propertyHash, name);
    }
    if (!res) {
      res = new Array<any>();
      this.setPropertyValueCore(this.propertyHash, name, res);
    }
    return res;
  }
  protected ensureArray(
    name: string,
    onPush: any = null,
    onRemove: any = null
  ) {
    if (this.arraysInfo && this.arraysInfo[name]) {
      return;
    }

    return this.createNewArray(name, onPush, onRemove);
  }

  protected createNewArray(
    name: string,
    onPush: any = null,
    onRemove: any = null
  ): Array<any> {
    var newArray = this.createNewArrayCore(name);
    if (!this.arraysInfo) {
      this.arraysInfo = {};
    }
    this.arraysInfo[name] = { onPush: onPush, isItemValues: false };
    var self = this;
    newArray.push = function (value): number {
      var result = Object.getPrototypeOf(newArray).push.call(newArray, value);
      if (!self.isDisposedValue) {
        if (onPush) onPush(value, newArray.length - 1);
        const arrayChanges = new ArrayChanges(
          newArray.length - 1,
          0,
          [value],
          []
        );
        self.propertyValueChanged(name, newArray, newArray, arrayChanges);
        self.notifyArrayChanged(newArray, arrayChanges);
      }
      return result;
    };
    newArray.shift = function (): number {
      var result = Object.getPrototypeOf(newArray).shift.call(newArray);
      if (!self.isDisposedValue && result) {
        if (onRemove) onRemove(result);
        const arrayChanges = new ArrayChanges(newArray.length - 1, 1, [], []);
        self.propertyValueChanged(name, newArray, newArray, arrayChanges);
        self.notifyArrayChanged(newArray, arrayChanges);
      }
      return result;
    };
    newArray.unshift = function (value): number {
      var result = Object.getPrototypeOf(newArray).unshift.call(
        newArray,
        value
      );
      if (!self.isDisposedValue) {
        if (onPush) onPush(value, newArray.length - 1);
        const arrayChanges = new ArrayChanges(0, 0, [value], []);
        self.propertyValueChanged(name, newArray, newArray, arrayChanges);
        self.notifyArrayChanged(newArray, arrayChanges);
      }
      return result;
    };
    newArray.pop = function (): number {
      var result = Object.getPrototypeOf(newArray).pop.call(newArray);
      if (!self.isDisposedValue) {
        if (onRemove) onRemove(result);
        const arrayChanges = new ArrayChanges(newArray.length - 1, 1, [], []);
        self.propertyValueChanged(name, newArray, newArray, arrayChanges);
        self.notifyArrayChanged(newArray, arrayChanges);
      }
      return result;
    };
    newArray.splice = function (
      start?: number,
      deleteCount?: number,
      ...items: any[]
    ): any[] {
      if (!start) start = 0;
      if (!deleteCount) deleteCount = 0;
      var result = Object.getPrototypeOf(newArray).splice.call(
        newArray,
        start,
        deleteCount,
        ...items
      );
      if (!items) items = [];
      if (!self.isDisposedValue) {
        if (onRemove && result) {
          for (var i = 0; i < result.length; i++) {
            onRemove(result[i]);
          }
        }
        if (onPush) {
          for (var i = 0; i < items.length; i++) {
            onPush(items[i], start + i);
          }
        }
        const arrayChanges = new ArrayChanges(
          start,
          deleteCount,
          items,
          result
        );
        self.propertyValueChanged(name, newArray, newArray, arrayChanges);
        self.notifyArrayChanged(newArray, arrayChanges);
      }
      return result;
    };

    return newArray;
  }
  protected getItemValueType(): string {
    return undefined;
  }
  protected setArray(
    name: string,
    src: any[],
    dest: any[],
    isItemValues: boolean,
    onPush: any
  ) {
    var deletedItems = [].concat(src);
    Object.getPrototypeOf(src).splice.call(src, 0, src.length);
    if (!!dest) {
      for (var i = 0; i < dest.length; i++) {
        var item = dest[i];
        if (isItemValues) {
          if (!!Base.createItemValue) {
            item = Base.createItemValue(item, this.getItemValueType());
          }
        }
        Object.getPrototypeOf(src).push.call(src, item);
        if (onPush) onPush(src[i]);
      }
    }
    const arrayChanges = new ArrayChanges(
      0,
      deletedItems.length,
      src,
      deletedItems
    );
    this.propertyValueChanged(name, deletedItems, src, arrayChanges);
    this.notifyArrayChanged(src, arrayChanges);
  }
  protected isTwoValueEquals(
    x: any,
    y: any,
    caseInSensitive: boolean = false,
    trimString: boolean = false
  ): boolean {
    return Helpers.isTwoValueEquals(x, y, false, !caseInSensitive, trimString);
  }
  private static copyObject(dst: any, src: any) {
    for (var key in src) {
      var source = src[key];
      if (typeof source === "object") {
        source = {};
        this.copyObject(source, src[key]);
      }
      dst[key] = source;
    }
  }
  protected copyCssClasses(dest: any, source: any): void {
    if (!source) return;
    if (typeof source === "string" || source instanceof String) {
      dest["root"] = source;
    } else {
      Base.copyObject(dest, source);
    }
  }
  private getValueInLowCase(val: any): any {
    if (!!val && typeof val == "string") return val.toLowerCase();
    return val;
  }
}

export class ArrayChanges {
  constructor(
    public index: number,
    public deleteCount: number,
    public itemsToAdd: any[],
    public deletedItems: any[]
  ) { }
}

export class Event<T extends Function, Options> {
  public onCallbacksChanged: () => void;
  protected callbacks: Array<T>;
  public get isEmpty(): boolean {
    return this.length === 0;
  }
  public get length(): number {
    return !!this.callbacks ? this.callbacks.length : 0;
  }
  public fireByCreatingOptions(sender: any, createOptions: () => Options): void {
    if (!this.callbacks) return;
    for (var i = 0; i < this.callbacks.length; i++) {
      this.callbacks[i](sender, createOptions());
      if (!this.callbacks) return;
    }
  }
  public fire(sender: any, options: Options): void {
    if (!this.callbacks) return;
    for (var i = 0; i < this.callbacks.length; i++) {
      this.callbacks[i](sender, options);
      if (!this.callbacks) return;
    }
  }
  public clear(): void {
    this.callbacks = undefined;
  }
  public add(func: T): void {
    if (this.hasFunc(func)) return;
    if (!this.callbacks) {
      this.callbacks = new Array<T>();
    }
    this.callbacks.push(func);
    this.fireCallbackChanged();
  }
  public remove(func: T): void {
    if (this.hasFunc(func)) {
      var index = this.callbacks.indexOf(func, 0);
      this.callbacks.splice(index, 1);
      this.fireCallbackChanged();
    }
  }
  public hasFunc(func: T): boolean {
    if (this.callbacks == null) return false;
    return this.callbacks.indexOf(func, 0) > -1;
  }
  private fireCallbackChanged(): void {
    if (!!this.onCallbacksChanged) {
      this.onCallbacksChanged();
    }
  }
}

export class EventBase<T> extends Event<
  (sender: T, options: any) => any,
  any
> { }
