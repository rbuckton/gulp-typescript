///<reference path='../definitions/ref.d.ts'/>
import ts = require('typescript');
import gutil = require('gulp-util');
import path = require('path');
import tsApi = require('./tsapi');
import utils = require('./utils');

export enum FileChangeState {
	New,
	Equal,
	Modified,
	Deleted,
	NotFound
}
export enum FileKind {
	Source,
	Config
}

export interface FileChange {
	previous: File;
	current: File;
	state: FileChangeState;
}

export interface File {
	gulp?: gutil.File;
	fileNameNormalized: string;
	fileNameOriginal: string;
	content: string;
	kind: FileKind;
	ts?: ts.SourceFile;
}
export module File {
	export function fromContent(filename: string, content: string): File {
		let kind = FileKind.Source;
		if (path.extname(filename).toLowerCase() === 'json') kind = FileKind.Config;

		return {
			fileNameNormalized: utils.normalizePath(filename),
			fileNameOriginal: filename,
			content,
			kind
		};
	}
	export function fromGulp(file: gutil.File): File {
		let str = file.contents.toString('utf8');
		let data = fromContent(file.path, str);
		data.gulp = file;

		return data;
	}

	export function equal(a: File, b: File): boolean {
		return (a.fileNameOriginal === b.fileNameOriginal)
			&& (a.content === b.content);
	}
	export function getChangeState(previous: File, current: File): FileChangeState {
		if (previous === undefined) {
			return current === undefined ? FileChangeState.NotFound : FileChangeState.New;
		}
		if (current === undefined) {
			return FileChangeState.Deleted;
		}
		if (equal(previous, current)) {
			return FileChangeState.Equal;
		}
		return FileChangeState.Modified;
	}
}

export class FileDictionary {
	files: utils.Map<File>;
	typescript: typeof ts;

	constructor(typescript: typeof ts) {
		this.typescript = typescript;
	}

	add(gFile: gutil.File) {
		let file = File.fromGulp(gFile);
		if (file.kind === FileKind.Source) this.initTypeScriptSourceFile(file);
		this.files[file.fileNameNormalized] = file;
	}

	getFile(name: string) {
		return this.files[utils.normalizePath(name)];
	}

	initTypeScriptSourceFile: (file: File) => void;
}

export class FileCache {
	previous: FileDictionary = undefined;
	current: FileDictionary;
	options: ts.CompilerOptions;

	typescript: typeof ts;
	version: number = 0;

	constructor(typescript: typeof ts) {
		this.typescript = typescript;
		this.current = new FileDictionary(typescript);
		this.current.initTypeScriptSourceFile = (file) => this.initTypeScriptSourceFile(file);
	}

	add(gFile: gutil.File) {
		this.current.add(gFile);
	}

	reset() {
		this.version++;
		this.previous = this.current;
		this.current = new FileDictionary(this.typescript);
	}

	private initTypeScriptSourceFile(file: File) {
		if (this.previous) {
			let previous = this.previous.getFile(name);
			if (File.equal(previous, file)) {
				file.ts = previous.ts; // Re-use previous source file.
				return;
			}
		}
		file.ts = tsApi.createSourceFile(this.typescript, file.fileNameOriginal, file.content, this.options.target, this.version + '')
	}

	getFile(name: string) {
		return this.current.getFile(name);
	}

	getFileChange(name: string): FileChange {
		let previous: File;
		if (this.previous) {
			previous = this.previous.getFile(name);
		}

		let current = this.current.getFile(name);

		return {
			previous,
			current,
			state: File.getChangeState(previous, current)
		};
	}
}
