const fs = require('fs'),
    readline = require('readline'),
    vm = require('vm');

var args = process.argv.slice(2);

const file = args[0];
console.log(file);
const fileInfo = GetFileInfo(file);
var rd = readline.createInterface({
    input: fs.createReadStream(file),
    output: process.stdout,
    console: false
});

let newHtml = "";
let scriptContent = "";
let foundScript = false;
rd.on('line', function(line) {   
    let newLine; 
    if(line.indexOf("</script>") > -1){ 
        newLine = line + "-->";
        foundScript = false; 
    } else if(line.indexOf("<script>") > -1){ 
        newLine = `<script src="./${fileInfo.name}.ts"></script>\n<!--${line}`;
        foundScript = true; 
    } else if(foundScript){ 
        scriptContent += line + "\n"; 
        newLine = line;
    } else {
        newLine = line.replace("polymer.html", "polymer-element.html");
    }
    newHtml += newLine + "\n";
}).on('close', ProcessFile);

function GetFileInfo(filePath) {
    const lastDirSlash = filePath.lastIndexOf("\\");
    const startIndex = lastDirSlash === -1 ? 0 : lastDirSlash + 1;
    const endIndex = filePath.indexOf(".html");
    const directory = filePath.substring(0, startIndex);
    return {
        name: filePath.substring(startIndex, endIndex),
        directory: directory,
        outputDir: directory + "output"
    };
}

function ProcessFile(){
    if(newHtml.indexOf("dom-module") === -1){
        console.log("No polymer element found.");
        return;
    }
    CheckOutputDirectory();
    WriteHtmlFile(newHtml);
    ProcessJavascript(scriptContent);
}

function CheckOutputDirectory(){
    if (!fs.existsSync(fileInfo.outputDir)){
        fs.mkdirSync(fileInfo.outputDir);
    }
}

function WriteHtmlFile(html) {
    fs.writeFile(`${fileInfo.outputDir}/${fileInfo.name}.html`, html, function(err){
        if (err) console.log(err);
        console.log("Successfully created html.");
    });
}

function WriteTsFile(ts) {
    fs.writeFile(`${fileInfo.outputDir}/${fileInfo.name}.ts`, ts, function(err){
        if (err) console.log(err);
        console.log("Successfully created ts file.");
    });
}

function ProcessJavascript(rawScript) {
    const script = MigrateCode(rawScript);
    const behaviors = GetBehaviors(script);
    const element = GetElementObj(script);
    const tsString = CreateTsString(element, behaviors);
    WriteTsFile(tsString);
}

function GetBehaviors(script) {
    const behaviorString = 'behaviors: ';
    const index = script.indexOf(behaviorString);
    if(index === -1) return null;
    const endIndex = script.indexOf("]", index) + 1;
    return script.substring(index + behaviorString.length, endIndex).replace(/\s+/g, "");
}

function GetElementObj(script){
    let element;
    const sandbox = {
        window: {},
        GenFitWindow: {},
        gencore: {
            Behaviors: {}
        },
        Polymer: function(obj) {
            element = obj;
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);
    return element;
}

function CreateTsString(element, behaviors) {
    return `
/// <reference path="../../../bower_components/polymer/types/polymer-element.d.ts" />
import { customElement, property ${element.observers ? ", observe " : ""}} from "../../../bower_components/polymer-decorators/src/decorators";

@customElement("${element.is}")
class ${GetClassName(element.is)} extends ${GetExtends(behaviors)} {
${GetProperties(element.properties)}
    constructor() {
        super();
    }
${GetConnectedCallback(element.attached)}
${GetDisconnectedCallback(element.detached)}
${GetElementMethods(element)}
}
    `;
}
function GetExtends(behaviors) {
    if(!behaviors) return "Polymer.Element";
    return `Polymer.mixinBehaviors(${behaviors}, Polymer.Element)`;
}
function GetClassName(elementName){
    return elementName.replace(/-/g, " ").replace(/(\w)(\w*)/g,
    (g0,g1,g2) => {return g1.toUpperCase() + g2.toLowerCase();}).replace(/\s/g, "") + "Element";
}
function PropertyObjectString(property) {
    var output = `{ type: ${property.type.name}`;
    if(property.notify) {
        output += `, notify: ${property.notify}`;
    }
    if(property.reflectToAttribute) {
        output += `, reflectToAttribute: ${property.reflectToAttribute}`;
    }
    if(property.readOnly) {
        output += `, readOnly: ${property.readOnly}`;
    }
    if(property.computed) {
        output += `, computed: '${property.computed}'`;
    }
    if(property.observer) {
        output += `, observer: '${property.observer}'`;
    }
    output += " }"
    return output;
}
function GetPropertyValue(property) {
    if(!property.hasOwnProperty("value")) return "";
    let value;
    if(typeof property.value === 'string') {
        value = `'${property.value}'`;
    } else if(property.value) {
        value = property.value.toString();
    } else value = property.value;

    return ` = ${value}`;
}
function GetProperties(properties) {
    const types = {
        "String": "string",
        "Boolean": "boolean",
        "Number": "number",
        "Object": "any",
        "Array": "any[]",
        "Date": "Date"
    }
    let propsString = "";
    for (const key in properties) {
        if (properties.hasOwnProperty(key)) {
            const property = properties[key];
            let hasPropObject = typeof property === 'object';
            let type = (hasPropObject ? property.type : property).name;
            propsString += `\t@property(${(hasPropObject ? PropertyObjectString(property) : `{ type: ${type} }`)})\n`
            propsString += `\t${key}: ${types[type]}${GetPropertyValue(property)};\n`
        }
    }

    return propsString;
}
function FormatMethod(methodName, method, prepend) {
    if(!method) return '';

    let methodString = method.toString().replace('function', '');
    methodString = methodString.replace(/function\s?\((.*)\)\s?{/g, "($1) => {");
    return methodName + methodString.substring(0, methodString.length - 1).replace(/\s{16}/g, "\n\t\t") + prepend + "\n\t}";
}
function GetConnectedCallback(attached) {
    return "\t" + FormatMethod("connectedCallback", attached, "\n\t\tsuper.connectedCallback();");
}
function GetDisconnectedCallback(detached) {
    return "\t" + FormatMethod("disconnectedCallback", detached, "\n\t\tsuper.disconnectedCallback();");
}
function GetMethodObserver(observers, methodName) {
    if(!observers) return null;
    for (const obs of observers) {
        if(obs.startsWith(methodName)){
            const params = obs.substring(methodName.length + 1, obs.length - 1).split(",");
            return params.map(x => `'${x.trim()}'`).join(',');
        }
    }
    return "";
}
function GetElementMethods(element) {
    const ignore = ["is", "attached", "detached", "properties", "listeners", "observers", "behaviors"];
    let methodsString = "";
    for (const key in element) {
        if (element.hasOwnProperty(key) && ignore.indexOf(key) === -1) {
            const observer = GetMethodObserver(element.observers, key);
            if(observer){
                methodsString += `\t@observe(${observer})\n`
            }
            methodsString += `\t${FormatMethod(key, element[key], "")}\n`;
        }
    }
    return methodsString;
}
function MigrateCode(code) {
    code = code.replace(/this\.listen\((\w+),\s?('[\w-]+'),\s?'(\w+)'\);/g, "$1.addEventListener($2, this.$3.bind(this));");
    code = code.replace(/this\.unlisten\((\w+),\s?('[\w-]+'),\s?'(\w+)'\);/g, "$1.removeEventListener($2, this.$3.bind(this));");
    //code = code.replace(/this.async\(function\s?\(\)/g, "setTimeout(() =>");
    // possible todos
    // Polymer.Debouncer
    // genesis specific migrations
    return code;
}