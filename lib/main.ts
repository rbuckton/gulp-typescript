import * as ts from 'typescript';
import * as fs from 'fs';
import * as gutil from 'gulp-util';
import * as path from 'path';
import * as stream from 'stream';
import { Project } from './project';
import * as utils from './utils';
import * as _filter from './filter';
import { Reporter, defaultReporter } from './reporter';
import * as compiler from './compiler';
import * as tsApi from './tsapi';
import * as through2 from 'through2';
import { VinylFile, TsConfig } from './types';

const PLUGIN_NAME = 'gulp-typescript';

class CompileStream extends stream.Duplex {
	constructor(proj: Project) {
		super({objectMode: true});

		this.project = proj;

		// Backwards compatibility
		this.js = this;

		// Prevent "Unhandled stream error in pipe" when compilation error occurs.
		this.on('error', () => {});
	}

	private project: Project;

	_write(file: any, encoding, cb: (err?) => void);
	_write(file: VinylFile, encoding, cb = (err?) => {}) {
		if (!file) return cb();

		if (file.isNull()) {
			cb();
			return;
		}
		if (file.isStream()) {
			return cb(new gutil.PluginError(PLUGIN_NAME, 'Streaming not supported'));
		}

		const isFirstFile = this.project.input.firstSourceFile === undefined;

		const inputFile = this.project.input.addGulp(file);

		if (isFirstFile) {
			this.project.currentDirectory = this.project.input.firstSourceFile.gulp.cwd;
		}

		this.project.compiler.inputFile(inputFile);

		cb();
	}
	_read() {

	}

	end(chunk?, encoding?, callback?) {
		this._write(chunk, encoding, callback);
		this.project.compiler.inputDone();
	}

	js: stream.Readable;
	dts: stream.Readable = new CompileOutputStream();
}
class CompileOutputStream extends stream.Readable {
	constructor() {
		super({objectMode: true});
	}

	_read() {

	}
}

function compile(): compile.CompileStream;
function compile(proj: Project, filters?: compile.FilterSettings, theReporter?: Reporter): compile.CompileStream;
function compile(settings: compile.Settings, filters?: compile.FilterSettings, theReporter?: Reporter): compile.CompileStream;
function compile(param?: any, filters?: compile.FilterSettings, theReporter?: Reporter): compile.CompileStream {
	let proj: Project;
	if (param instanceof Project) {
		proj = param;
		if (proj.running) {
			throw new Error('gulp-typescript: A project cannot be used in two compilations at the same time. Create multiple projects with createProject instead.');
		}
		proj.running = true;
	} else {
		proj = compile.createProject(param || {});
	}

	const inputStream = new CompileStream(proj);

	proj.reset(inputStream.js, inputStream.dts);
	proj.filterSettings = filters;
	proj.reporter = theReporter || defaultReporter();

	proj.compiler.prepare(proj);

	return inputStream;
}

type Enum = utils.Map<number | string>;
function createEnumMap(input: Enum): utils.Map<number> {
	const map: utils.Map<number> = {};
	const keys = Object.keys(input);

	for (const key of keys) {
		let value = input[key];
		if (typeof value === 'number') {
			map[key.toLowerCase()] = value;
		}
	}

	return map;
}

function getScriptTarget(typescript: typeof ts, language: string) {
	const map: utils.Map<ts.ScriptTarget> = createEnumMap((<any> typescript).ScriptTarget);
	return map[language.toLowerCase()];
}

function getModuleKind(typescript: typeof ts, moduleName: string) {
	const map: utils.Map<ts.ModuleKind> = createEnumMap((<any> typescript).ModuleKind);
	return map[moduleName.toLowerCase()];
}

function getModuleResolution(typescript: typeof ts, kind: string) {
	if ((<any> typescript).ModuleResolutionKind === undefined) {
		return undefined; // Not supported in TS1.4 & 1.5
	}
	// Enum member name is NodeJs, while option name is `node`
	if (kind === 'node') kind = 'nodejs';
	const map: utils.Map<number> = createEnumMap((<any> typescript).ModuleResolutionKind);
	return map[kind.toLowerCase()];
}

function getJsxEmit(typescript: typeof ts, jsx: string) {
	if ((<any> typescript).JsxEmit === undefined) {
		return undefined; // Not supported in TS1.4 & 1.5
	}
	const map: utils.Map<number> = createEnumMap((<any> typescript).JsxEmit);
	return map[jsx.toLowerCase()];
}


function getCompilerOptions(settings: compile.Settings, projectPath: string, configFileName: string): ts.CompilerOptions {
	var typescript = settings.typescript || ts;

	if (settings.sourceRoot !== undefined) {
		console.warn('gulp-typescript: sourceRoot isn\'t supported any more. Use sourceRoot option of gulp-sourcemaps instead.')
	}

	// Try to use `convertCompilerOptionsFromJson` to convert options.
	if ((<tsApi.TypeScript>typescript).convertCompilerOptionsFromJson) {
		// Copy settings and remove several options
		const newSettings: compile.Settings = {};
		for (const option of Object.keys(settings)) {
			if (option === 'declarationFiles') {
				newSettings.declaration = settings.declarationFiles;
				continue;
			}
			if (option === 'noExternalResolve' ||
				option === 'sortOutput' ||
				option === 'typescript' ||
				option === 'sourceMap' ||
				option === 'inlineSourceMap') continue;

			newSettings[option] = settings[option];
		}

		const result = (<tsApi.TypeScript>typescript).convertCompilerOptionsFromJson(newSettings, projectPath, configFileName);
		const reporter = defaultReporter();
		for (const error of result.errors) {
			reporter.error(utils.getError(error, typescript), typescript);
		}
		result.options.sourceMap = true;
		(<tsApi.TSOptions18> result.options).suppressOutputPathCheck = true;
		return result.options;
	}

	// Legacy conversion
	const tsSettings: ts.CompilerOptions = {};

	for (const key in settings) {
		if (!Object.hasOwnProperty.call(settings, key)) continue;
		if (key === 'noExternalResolve' ||
			key === 'declarationFiles' ||
			key === 'sortOutput' ||
			key === 'typescript' ||
			key === 'target' || // Target, module, moduleResolution, sourceRoot & jsx are added below
			key === 'module' ||
			key === 'moduleResolution' ||
			key === 'jsx' ||
			key === 'sourceRoot' ||
			key === 'sourceMap' ||
			key === 'inlineSourceMap') continue;

		tsSettings[key] = settings[key];
	}

	if (typeof settings.target === 'string') {
		tsSettings.target = getScriptTarget(typescript, <string> settings.target);
	} else if (typeof settings.target === 'number') {
		tsSettings.target = <number> settings.target;
	}
	if (typeof settings.module === 'string') {
		tsSettings.module = getModuleKind(typescript, <string> settings.module);
	} else if (typeof settings.module === 'number') {
		tsSettings.module = <number> settings.module;
	}
	if (typeof settings.jsx === 'string') {
		// jsx is not supported in TS1.4 & 1.5, so we cannot do `tsSettings.jsx = `, but we have to use brackets.
		tsSettings['jsx'] = getJsxEmit(typescript, <string> settings.jsx);
	} else if (typeof settings.jsx === 'number') {
		tsSettings['jsx'] = <number> settings.jsx;
	}
	if (typeof settings.moduleResolution === 'string') {
		// moduleResolution is not supported in TS1.4 & 1.5, so we cannot do `tsSettings.moduleResolution = `, but we have to use brackets.
		tsSettings['moduleResolution'] = getModuleResolution(typescript, <string> settings.moduleResolution);
	} else if (typeof settings.moduleResolution === 'number') {
		tsSettings['moduleResolution'] = <number> settings.moduleResolution;
	}

	if (tsApi.isTS14(typescript)) {
		if (tsSettings.target === undefined) {
			// TS 1.4 has a bug that the target needs to be set.
			tsSettings.target = ts.ScriptTarget.ES3;
		}
		if (tsSettings.module === undefined) {
			// Same bug in TS 1.4 as previous comment.
			tsSettings.module = ts.ModuleKind.None;
		}
	}

	if (settings.declarationFiles !== undefined) {
		tsSettings.declaration = settings.declarationFiles;
	}

	tsSettings.sourceMap = true;

	// Suppress errors when providing `allowJs` without `outDir`.
	(<tsApi.TSOptions18> tsSettings).suppressOutputPathCheck = true;

	if ((<tsApi.TSOptions20> tsSettings).baseUrl) {
		(<tsApi.TSOptions20> tsSettings).baseUrl = path.resolve(projectPath, (<tsApi.TSOptions20> tsSettings).baseUrl);
	}
	if ((<tsApi.TSOptions20> tsSettings).rootDirs) {
		(<tsApi.TSOptions20> tsSettings).rootDirs = (<tsApi.TSOptions20> tsSettings).rootDirs.map(
			dir => path.resolve(projectPath, dir)
		);
	}

	return tsSettings;
}

module compile {
	export interface CompileStream extends stream.Duplex {
		js: stream.Readable;
		dts: stream.Readable;
	}
	export interface Settings {
		out?: string;
		outFile?: string;
		outDir?: string;

		allowNonTsExtensions?: boolean;
		charset?: string;
		codepage?: number;
		declaration?: boolean; // alias of declarationFiles
		locale?: string;
		mapRoot?: string;
		noEmitOnError?: boolean;
		noImplicitAny?: boolean;
		noLib?: boolean;
		noLibCheck?: boolean;
		noResolve?: boolean;
		preserveConstEnums?: boolean;
		removeComments?: boolean;
		suppressImplicitAnyIndexErrors?: boolean;

		target?: string | ts.ScriptTarget;
		module?: string | ts.ModuleKind;
		moduleResolution?: string | number;
		jsx?: string | number;

		declarationFiles?: boolean;

		noExternalResolve?: boolean;
		sortOutput?: boolean;

		typescript?: typeof ts;

		isolatedModules?: boolean;

		rootDir?: string;

		// Unsupported by gulp-typescript
		sourceRoot?: string; // Use sourceRoot in gulp-sourcemaps instead
	}
	export interface FilterSettings {
		referencedFrom: string[];
	}

	export function createProject(settings?: Settings): Project;
	export function createProject(tsConfigFileName: string, settings?: Settings): Project;
	export function createProject(fileNameOrSettings?: string | Settings, settings?: Settings): Project {
		let tsConfigFileName: string = undefined;
		let tsConfigContent: TsConfig = undefined;
		let projectDirectory = process.cwd();
		if (fileNameOrSettings !== undefined) {
			if (typeof fileNameOrSettings === 'string') {
				tsConfigFileName = fileNameOrSettings;
				projectDirectory = path.dirname(fileNameOrSettings);
				// load file and strip BOM, since JSON.parse fails to parse if there's a BOM present
				let tsConfigText = fs.readFileSync(fileNameOrSettings).toString();
				const typescript = (settings && settings.typescript) || ts;
				const tsConfig = tsApi.parseTsConfig(typescript, tsConfigFileName, tsConfigText);
				tsConfigContent = tsConfig.config || {};
				if (tsConfig.error) {
					console.log(tsConfig.error.messageText);
				}
				let newSettings: any = {};
				if (tsConfigContent.compilerOptions) {
					for (const key of Object.keys(tsConfigContent.compilerOptions)) {
						newSettings[key] = tsConfigContent.compilerOptions[key];
					}
				}
				if (settings) {
					for (const key of Object.keys(settings)) {
						newSettings[key] = settings[key];
					}
				}
				settings = newSettings;
			} else {
				settings = fileNameOrSettings;
			}
		}

		const project = new Project(tsConfigFileName, projectDirectory, tsConfigContent, getCompilerOptions(settings, projectDirectory, tsConfigFileName), settings.noExternalResolve ? true : false, settings.sortOutput ? true : false, settings.typescript);

		// Isolated modules are only supported when using TS1.5+
		if (project.options['isolatedModules'] && !tsApi.isTS14(project.typescript)) {
			if (project.options.out !== undefined || project.options['outFile'] !== undefined || project.sortOutput) {
				console.warn('You cannot combine option `isolatedModules` with `out`, `outFile` or `sortOutput`');
			}

			project.options['newLine'] = (<any>ts).NewLineKind.LineFeed; //new line option/kind fails TS1.4 typecheck
			project.options.sourceMap = false;
			project.options.declaration = false;
			project.options['inlineSourceMap'] = true;
			project.compiler = new compiler.FileCompiler();
		} else {
			project.compiler = new compiler.ProjectCompiler();
		}

		return project;
	}

	export function filter(project: Project, filters: FilterSettings): NodeJS.ReadWriteStream {
		let filterObj: _filter.Filter = undefined;
		return through2.obj(function (file: gutil.File, encoding, callback: () => void) {
			if (!filterObj) { // Make sure we create the filter object when the compilation is complete.
				filterObj = new _filter.Filter(project, filters);
			}

			if (filterObj.match(file.path)) this.push(file);

			callback();
		});
	}

	export function types(): NodeJS.ReadWriteStream {
		return through2.obj(function (file: VinylFile, encoding, callback: () => void) {
			this.push(file);
			if (file.types) {
				this.push(file.types);
			}
			callback();
		});
	}
}

export = compile;
