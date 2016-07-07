import * as ts from 'typescript';
import * as stream from 'stream';
import { Project } from './project';
import { Reporter } from './reporter';
declare function compile(): compile.CompileStream;
declare function compile(proj: Project, filters?: compile.FilterSettings, theReporter?: Reporter): compile.CompileStream;
declare function compile(settings: compile.Settings, filters?: compile.FilterSettings, theReporter?: Reporter): compile.CompileStream;
declare module compile {
    interface CompileStream extends stream.Duplex {
        js: stream.Readable;
        dts: stream.Readable;
    }
    interface Settings {
        out?: string;
        outFile?: string;
        outDir?: string;
        allowNonTsExtensions?: boolean;
        charset?: string;
        codepage?: number;
        declaration?: boolean;
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
        sourceRoot?: string;
    }
    interface FilterSettings {
        referencedFrom: string[];
    }
    function createProject(settings?: Settings): Project;
    function createProject(tsConfigFileName: string, settings?: Settings): Project;
    function filter(project: Project, filters: FilterSettings): NodeJS.ReadWriteStream;
    function types(): NodeJS.ReadWriteStream;
}
export = compile;
