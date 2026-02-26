/*******************************************************************************
Copyright 2025 HCL Software

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*******************************************************************************/

/**
 * The Art Tutorial: Exercises command implementation
 * 
 * @author Mattias Mohlin
 */

import * as vscode from 'vscode';
const fs = require('fs');
import { parse } from 'node-html-parser';
import { Exercise } from './exercise.js';
import { hasOwnProperty, logMessage, markdownToHTML, replaceAll } from './utils.js';
import { runExercise } from './runExercise.js';

let exercisesMap = new Map<string, Exercise>();

// Populate the workspace and exercise map from the contents of the given folder
function readExercises(location : string) {
    exercisesMap.clear();
    let exerciseFolders = [];

    let items = fs.readdirSync(location, { withFileTypes : true });    
    for (let item of items) {
        if (!item.isDirectory())
            continue;

        if (!item.name.endsWith('_data')) {
            // This could be an actual exercise, but we may perhaps not yet have seen its metadata folder
            exerciseFolders.push(item.name);
            continue; 
        }
        
        // This should be a metadata folder for an exercise
        let exerciseName = item.name.substring(0, item.name.lastIndexOf('_data'));
        let exercise = new Exercise(exerciseName, location + '/' + item.name);

        try {
            const exerciseMarkdown = fs.readFileSync(location + '/' + item.name + '/exercise.md', 'utf8');
            exercise.descriptionHTML = markdownToHTML(exerciseMarkdown);
        }
        catch (err) {
            logMessage('Failed to read file exercise.md in ' + item.name + ". This exercise will be skipped!"); 
            continue;        
        }

        // Read and evaluate exercise.json file
        try {
            const config = JSON.parse(fs.readFileSync(location + '/' + item.name + '/exercise.json', 'utf8'));
            exercise.checkAndSetConfigProperty(config, 'order', 'number');
            exercise.checkAndSetConfigProperty(config, 'expectedToTerminate', 'boolean');
            exercise.checkAndSetConfigProperty(config, 'expectedOutput', 'string[]');
            exercise.checkAndSetConfigProperty(config, 'allowAdditionalOutput', 'boolean');
            exercise.checkAndSetConfigProperty(config, 'allowErrorPrintouts', 'boolean');
            exercise.checkAndSetConfigProperty(config, 'killAfter', 'number');
            exercise.checkAndSetConfigProperty(config, 'interactive', 'boolean');
        }
        catch (err) {
            if (err instanceof TypeError) {
                logMessage(`${err.message}. This exercise will be skipped!`);                   
            }
            else {
                logMessage(`Failed to read file exercise.json in ${item.name}. This exercise will be skipped!`);
            }
            continue;        
        }        

        // Check if the exercise has a provided solution
        if (fs.existsSync(location + '/' + exercise.name + '_solution')) {
            exercise.solutionFolder = location + '/' + exercise.name + '_solution';
        }        

        try {
            const hintMarkdown = fs.readFileSync(location + '/' + item.name + '/hint.md', 'utf8');
            exercise.hintHTML = markdownToHTML(hintMarkdown);
        }
        catch (err) {
            // This exercise has no hint            
        }

        try {
            const completedTimestamp = fs.readFileSync(location + '/' + item.name + '/.completed', 'utf8');
            exercise.completed = completedTimestamp;
        }
        catch (err) {
            // This exercise has no hint            
        }

        exercisesMap.set(exerciseName, exercise);
    }

    // Connect exercise folders and make sure they are present in the workspace
    let toBeAdded : { uri: vscode.Uri, name: string}[] = [];
    for (let e of exerciseFolders) {
        let exercise = exercisesMap.get(e);
        if (!exercise) {
            if (!e.endsWith('_target') && // Ignore target folders present from previous builds
                !e.endsWith('_solution') && // Ignore solution folders (they are handled above)
                !e.startsWith('.')) { // Ignore for example .git folder
                logMessage('The folder "' + e + '_data" is not present, but is expected because a corresponding exercise folder "' + e + '" is in ' + location + '. This exercise will be skipped!');
            }
            exercisesMap.delete(e.name);
            continue;
        }

        if (!fs.existsSync(location + '/' + exercise.name + '/app.tcjs')) {
            logMessage('The exercise "' + exercise.name + '" is missing a TC file "app.tcjs". This exercise will be skipped!');
            exercisesMap.delete(e.name);
            continue;
        }

        exercise.tcFile = location + '/' + exercise.name + '/app.tcjs';
        exercise.folder = location + '/' + exercise.name;
        exercise.dataFolder = location + '/' + exercise.name + '_data';

        let workspaceFolder = vscode.workspace.workspaceFolders?.find(folder => folder.name === exercise.name);
        
        if (!workspaceFolder) {
            let wfUri: vscode.Uri = vscode.Uri.file(location + '/' + exercise.name);  
            toBeAdded.push({uri: wfUri, name: exercise.name});
        }                
    }

    if (toBeAdded.length > 0) {
        vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, null, ...toBeAdded)
    }

    // Sort exercises by their "order" property once, so iterations are always in order
    const sortedEntries = [...exercisesMap.entries()].sort((a, b) => a[1].order - b[1].order);
    exercisesMap.clear();
    for (const [key, value] of sortedEntries) {
        exercisesMap.set(key, value);
    }
}

// Return a nonce value for the web view
function getNonce(): string {
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	const parts: string[] = [];
	for (let i = 0; i < 32; i++) {
		parts.push(possible.charAt(Math.floor(Math.random() * possible.length)));
	}
	return parts.join('');
}

let introHTML : string = undefined;
// Get the HTML for the introduction of the Art Tutorial
function getIntroHTML(extensionUri : vscode.Uri) : string {
    if (introHTML)
        return introHTML;

    const introMarkdownPath = vscode.Uri.joinPath(extensionUri, 'webview', 'introduction.md');
    const introMarkdown = fs.readFileSync(introMarkdownPath.fsPath, 'utf8');
    introHTML = markdownToHTML(introMarkdown);

    return introHTML;
}

let defaultExerciseLocation : vscode.Uri = undefined;

export function registerExercisesCmd(context: vscode.ExtensionContext) {
    return vscode.commands.registerCommand('art-tutorial.exercises', async (...commandArgs) => {         
        if (!defaultExerciseLocation) {
            defaultExerciseLocation = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri : undefined;
        }
        let locationUri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            title: 'Enter the path to where exercises are located',
            defaultUri: defaultExerciseLocation
        })
        if (!locationUri || locationUri.length == 0)
            return; // Cancelled
        
        defaultExerciseLocation = locationUri[0];

        let location = locationUri[0].fsPath;

        readExercises(location);

        let localResourceRoots = [];
        for (let [name, exercise] of exercisesMap) {
            let dataFolder = vscode.Uri.file(exercise.dataFolder);
            localResourceRoots.push(dataFolder);
        }
        localResourceRoots.push(context.extensionUri);

        const panel = vscode.window.createWebviewPanel(
			'art-tutorial-webview',
			'Art Tutorial: Exercises',
			vscode.ViewColumn.One,
			{
				enableScripts: true,				
				retainContextWhenHidden: true,
				enableCommandUris: true,
                localResourceRoots: localResourceRoots
			}
		);

        const nonce = getNonce();

        const extensionUri = context.extensionUri;
        const webviewPath = vscode.Uri.joinPath(extensionUri, 'webview', 'index.html');        
        const cssPath = vscode.Uri.joinPath(extensionUri, 'webview', 'styles.css');
        const prismCssPath = vscode.Uri.joinPath(extensionUri, 'webview', 'prism.css');
        const artIconUri  = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', 'art_lang.svg'));
        const infoIconUri  = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', 'info.svg'));
        const webViewHTML = fs.readFileSync(webviewPath.fsPath, 'utf8').replaceAll('${nonce}', nonce).replaceAll('${webview.cspSource}', panel.webview.cspSource).replaceAll('${infoIconUri}', infoIconUri);
        const webViewCSS = fs.readFileSync(cssPath.fsPath, 'utf8').replaceAll('${art_icon_uri}', artIconUri);
        const prismCSS = fs.readFileSync(prismCssPath.fsPath, 'utf8');

        const dom = parse(webViewHTML);
        let mainStyleNode = dom.querySelector('#main_style');
        if (mainStyleNode)
            mainStyleNode.set_content(webViewCSS);

        let prismStyleNode = dom.querySelector('#prism_style');
        if (prismStyleNode)
            prismStyleNode.set_content(prismCSS);
        
        let exercisesLocation = dom.querySelector('#exercises_location');
        if (exercisesLocation) {
            exercisesLocation.textContent = location;
        }

        let totalExercisesCount = dom.querySelector('#total_exercises_count');
        if (totalExercisesCount) {
            totalExercisesCount.textContent = String(exercisesMap.size);
        }

        let descriptionDiv = dom.querySelector('#description_div');
        if (descriptionDiv) {
            descriptionDiv.innerHTML = getIntroHTML(extensionUri);                
        }

        let count = 0;
        let completedCount = 0;
        let exerciseTable = dom.querySelector('#exercises_table');
        if (exerciseTable) {

            // One table row for each exercise
            for (let [name, exercise] of exercisesMap) {
                const openButton = '<button class="open_button" type="button">Open</button>';
                const hintButton = '<button class="hint_button" type="button"' + (!exercise.hintHTML ? ' disabled' : '') + '>Hint</button>';
                const runButton = '<button class="run_button" type="button">Run</button>';
                const completeButton = '<button class="complete_button' + (exercise.completed ? ' hidden' : '') + '" type="button">Complete</button>';
                const reopenButton = '<button class="reopen_button' + (!exercise.completed ? ' hidden' : '') + '" type="button">Reopen</button>';
                const solutionButton = '<button class="solution_button" type="button"' + (!exercise.solutionFolder ? ' disabled' : '') + '>View Solution</button>';
                const row = parse('<tr' + (exercise.completed ? ' class="completed"' : '') + '><td>' + (++count) + ": " + name + '</td><td>' + openButton + '</td><td>' + hintButton + '</td><td>' + runButton + '</td><td>' + completeButton + reopenButton + '</td><td>' + solutionButton + '</td></tr>');
                exerciseTable.appendChild(row);   
                                
                if (exercise.completed)
                    completedCount++;

                // Set correct web view URIs for resources referenced by the exercise description
                exercise.descriptionHTML = replaceAll(exercise.descriptionHTML, 'src="', 'nonce="' + nonce + '" src="' + panel.webview.asWebviewUri(vscode.Uri.file(exercise.dataFolder)) + '/');                
            }            
        }     

        let completedExercisesCount = dom.querySelector('#completed_exercises_count');
        if (completedExercisesCount) {
            completedExercisesCount.textContent = String(completedCount);
        }        

        const script_uri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri,'script', 'extensionscript.js'));
        let mainScriptNode = dom.querySelector('#main_script');
        if (mainScriptNode)
            mainScriptNode.setAttribute('src', script_uri.toString());

        const prism_script_uri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri,'script', 'prism.js'));
        let prismScriptNode = dom.querySelector('#prism_script');
        if (prismScriptNode)
            prismScriptNode.setAttribute('src', prism_script_uri.toString());

        let updatedWebViewHTML = dom.toString();
		panel.webview.html = updatedWebViewHTML;

        // Message handler for webview
		handleWebviewMessage(panel, context);
    });       
}

function handleWebviewMessage(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
	panel.webview.onDidReceiveMessage(
		async (message) => {            
			if (typeof message.command === 'string') {
				switch (message.command) {			
                    case 'showInfo': {
                        panel.webview.postMessage({ 
                            command: 'showExerciseDescription',
                            descriptionHTML: getIntroHTML(context.extensionUri)
                        });                                              
                    }
					break;		
					case 'openExercise': {
                        let exercise = exercisesMap.get(message.exerciseName);
                        if (exercise) {
                            panel.webview.postMessage({ 
                                command: 'showExerciseDescription',
                                descriptionHTML: exercise.descriptionHTML
                            });
                        }
                        let tcUri: vscode.Uri = vscode.Uri.file(exercise.tcFile);  
                        let options: vscode.TextDocumentShowOptions = {
                            viewColumn: vscode.ViewColumn.Beside
                        };
                        vscode.commands.executeCommand("vscode.open", tcUri, options); 
                    }
					break;					
                    case 'openHint': {
                        let exercise = exercisesMap.get(message.exerciseName);
                        if (exercise) {
                            panel.webview.postMessage({ 
                                command: 'showExerciseHint',
                                descriptionHTML: exercise.descriptionHTML,
                                hintHTML: exercise.hintHTML
                            });
                        }                        
                    }
					break;
                    case 'completeExercise': {
                        let exercise = exercisesMap.get(message.exerciseName);
                        if (exercise) {
                            if (exercise.complete()) {
                                panel.webview.postMessage({ 
                                    command: 'exerciseStatusChanged',
                                    exercise: exercise.name,
                                    completed: exercise.completed
                                });
                            }
                        }                        
                    }
					break;
                    case 'reopenExercise': {
                        let exercise = exercisesMap.get(message.exerciseName);
                        if (exercise) {
                            if (exercise.reopen()) {
                                panel.webview.postMessage({ 
                                    command: 'exerciseStatusChanged',
                                    exercise: exercise.name,
                                    completed: ''
                                });
                            }
                        }                        
                    }
					break;
                    case 'viewSolution': {
                        let exercise = exercisesMap.get(message.exerciseName);
                        if (exercise && exercise.solutionFolder) {
                            // Open the solution folder in the workspace
                            let solutionWSFolder = vscode.workspace.workspaceFolders?.find(folder => folder.name === exercise.name + "_solution");
        
                            if (!solutionWSFolder) {                                
                                let wfToAdd = [{ uri: vscode.Uri.file(exercise.solutionFolder), name : exercise.name + "_solution" }];
                                vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, null, ...wfToAdd);
                            }

                            // Also open the TC file in the solution folder if it exists
                            if (fs.existsSync(exercise.solutionFolder + '/app.tcjs')) {
                                let tcUri: vscode.Uri = vscode.Uri.file(exercise.solutionFolder + '/app.tcjs');  
                                let options: vscode.TextDocumentShowOptions = {
                                    viewColumn: vscode.ViewColumn.Beside
                                };
                                vscode.commands.executeCommand("vscode.open", tcUri, options); 
                            }                            
                        }                        
                    }
					break; 
                    case 'runExercise': {
                        let exercise = exercisesMap.get(message.exerciseName);
                        if (exercise) {
                            let successful = await runExercise(exercise);
                            if (successful) {
                                logMessage(`Congratulations! Your solution for exercise "${exercise.name}" works correctly!`);
                                if (exercise.interactive) {
                                    logMessage(`...however, this exercise involves some interactive steps which were not tested!`);
                                }
                            }
                            else {
                                logMessage(`Your solution for exercise "${exercise.name}" does not work correctly! Refer to above messages for details.`);
                            }
                            logMessage('--------------------------------------------------------------------------------------------------------');
                        }                        
                    }
					break;
                    case 'openFile': {
                        let exercise = exercisesMap.get(message.exerciseName);
                        if (exercise) {
                            // File paths are relative to the exercise folder
                            let fileUri: vscode.Uri = vscode.Uri.file(exercise.folder + '/' + message.filePath);   
                            let options: vscode.TextDocumentShowOptions = {
                                viewColumn: vscode.ViewColumn.Beside
                            };                         
                            vscode.commands.executeCommand("vscode.open", fileUri, options);                            
                        }
                    }
					break; 
                    default:
                        logMessage("Internal error: Invalid message received from webview");
				}
			}
            else {
				logMessage("Internal error: Invalid message received from webview");
			}
		},
		undefined,
		context.subscriptions
	);
}