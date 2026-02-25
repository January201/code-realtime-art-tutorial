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

import * as vscode from 'vscode';
const { spawn } = require('child_process');
const fs = require('fs');
import { Exercise } from "./exercise";
import { checkCommandFailure, logMessage } from "./utils";


// Run an exercise app and print in the Art Tutorial output channel if it works correctly or not
// Returns true if the exercise app was run successfully, false otherwise
export async function runExercise(exercise : Exercise) : Promise<boolean> {
    let tcUri: vscode.Uri = vscode.Uri.file(exercise.tcFile);      

    let wsFolder :vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(tcUri);
    if (!wsFolder) {
        logMessage(`The exercise TC ${tcUri.fsPath} is not present in the workspace which prevents it from being run.`);
        return false;
    }

    const result : string = await vscode.commands.executeCommand('art.getTCConfig', wsFolder.uri.fsPath, tcUri.fsPath, false /* do not validate the TC */);
    const cmdResult = checkCommandFailure(result);
    if (cmdResult.failed) {
        logMessage(`Failed to extract from the TC ${tcUri.fsPath} necessary information for running the exercise. Reason: ${cmdResult.msg}`);
        return false;
    }
    const tcConfig = JSON.parse(result);
    let targetFolder : string = tcConfig.targetFolderPath;    
    if (process.platform === 'win32') {
        tcConfig.executableName = tcConfig.executableName + '.EXE';
    }
    else {
        tcConfig.executableName = './' + tcConfig.executableName;
    }
    let executablePath = tcConfig.buildPath + '/' + tcConfig.executableName;

    // Build the exercise (clean it first if it was built before)
    if (fs.existsSync(tcConfig.targetFolderPath)) {

        if (fs.existsSync(executablePath)) {
            // A common mistake is to forget to kill an exercise app and if Top.EXE is still running Clean and Build will fail.    
            try {    
                fs.unlinkSync(executablePath); // Delete the executable if it exists
            }
            catch (err) {
                logMessage(`The executable ${executablePath} is currently running which prevents it from being built. Kill its process and try again.`);
                return false;
            }
        }

        await vscode.commands.executeCommand('code-rt.cleanTC', tcUri);
    }
    await vscode.commands.executeCommand('code-rt.buildActiveTC', tcUri); 

    // Check so that the build produced an executable in the default folder    
    
    if (!targetFolder) {
        logMessage(`Failed to get target folder from the TC of "${exercise.name}"`);
        return false;
    }

    if (!fs.existsSync(executablePath)) {
        logMessage(`Building the exercise "${exercise.name}" did not produce an executable at ${executablePath}. Check the Terminal "make: TC (${exercise.name})" for error messages.`);
        return false;
    }

    // Run the exercise asynchronously
    return new Promise<boolean>((resolve, reject) => {
        logMessage(`Built exercise "${exercise.name}" successfully. Now testing if it works correctly...`);

        let receivedExpectedOutput = false; 
        let properTermination = true; 
        let runtimeProblems = false;
        let receivedUnexpectedAdditionalOutput = false;
        
        let outputToBeReceived =  exercise.expectedOutput.slice();

        let childProcess;
        try {
            childProcess = spawn(tcConfig.executableName, ['-URTS_DEBUG=quit'], {cwd : tcConfig.buildPath});
        }
        catch (err) {
            logMessage(`Failed to launch built executable for exercise "${exercise.name}"`);
            resolve(false);
        }                            

        // Kill the child process if it doesn't terminate by itself within the time limit
        // Note that some exercises are designed to not terminate by themselves, so this doesn't necessarily indicate an error
        let timer = setTimeout(() => {
            childProcess.kill('SIGINT');
            logMessage(`Application built for exercise "${exercise.name}" was automatically terminated after ${exercise.killAfter} seconds.`);
            if (exercise.expectedToTerminate) {
                logMessage(`...this is an error since it was expected to terminate by itself.`);
                properTermination = false;
            }
        }, exercise.killAfter * 1000); 

        childProcess.on('error', (err) => {
            // Run-time errors are always unexpected (e.g. failure to launch it)
            logMessage(`Application built for exercise "${exercise.name}" experienced a run-time error: ${err}`); 
            resolve(false);
        });

        childProcess.stdout.on('data', (data) => {
            // Match with the expected printout            
            if (outputToBeReceived && outputToBeReceived.length > 0) {
                data.toString().trim().split('\n').forEach((line : string) => {
                    if (outputToBeReceived[0] === line.trim()) {
                        outputToBeReceived.shift();
                    }
                });
                
                if (outputToBeReceived.length == 0) {
                    // All expected output has been printed
                    receivedExpectedOutput = true;
                }
            }
            else if (outputToBeReceived && outputToBeReceived.length == 0 && !exercise.allowAdditionalOutput) {
                receivedUnexpectedAdditionalOutput = true;
            }            
        });

        childProcess.stderr.on('data', (data) => {
            const str = data.toString();
            if (!exercise.allowErrorPrintouts) {
                // Printouts to stderr are unexpected (except the start-up printouts)
                if (str.startsWith('RT C++ Target Run Time System')) 
                    return;

                logMessage(`Application built for exercise "${exercise.name}" printed an error: ${str}`);
                runtimeProblems = true;
            }
        });

        childProcess.on('close', (code) => {
            // Run completed. We will always come here, so this is where we decide if the run was successful or not.
            clearTimeout(timer);                                
                
            let expectedOutputFormatted = exercise.expectedOutput ? 
                ((exercise.expectedOutput.length > 1 ? '\n' : '') + exercise.expectedOutput.join('\n')) 
                : '';
            if (exercise.expectedOutput && !receivedExpectedOutput) {
                logMessage(`Application built for exercise "${exercise.name}" did not print the expected: ${expectedOutputFormatted}`);
            }
            else if (exercise.expectedOutput && receivedUnexpectedAdditionalOutput) {
                logMessage(`Application built for exercise "${exercise.name}" printed the expected output ${expectedOutputFormatted}\nbut also something more which was not expected.`);
            }

            if (code && code !== 0) {
                logMessage(`Application built for exercise "${exercise.name}" terminated with an error status code: ${code}`);
                resolve(false);
            }
            else {
                resolve(receivedExpectedOutput && !receivedUnexpectedAdditionalOutput && properTermination && !runtimeProblems);
            }
        });     
    });
}