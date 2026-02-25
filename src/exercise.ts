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
 * Captures all data related to an exercise
 * 
 * @author Mattias Mohlin
 */

const fs = require('fs');
import { getTimestamp, logMessage } from './utils.js';

export class Exercise {
    name: string; // Name of exercise (same as folder name)
    folder: string; // Path to exercise folder 
    dataFolder: string; // Path to exercise data folder
    solutionFolder: string; // Path to exercise solution folder
    descriptionHTML: string; // HTML description of exercise (from the exercise.md file)
    hintHTML: string = undefined; // HTML description of exercise (from the hint.md file). Undefined if no hint is available.
    tcFile: string; // Path to TC file (app.tcjs) for the exercise
    completed: string = ''; // Timestamp when the exercise was completed, or empty if not completed    

    // Config properties (configurable in excercise.json)
    order: number = 0; // Order of exercise in the list of exercises (lowest comes first)
    expectedOutput: string[]; // If set, the exercise is expected to print this output on stdout.
    allowAdditionalOutput: boolean = true; // True if the exercise app is allowed to print something else to stdout.
    allowErrorPrintouts: boolean = false; // True if the exercise app is expected to print something to stderr.
    expectedToTerminate: boolean = false; // True if the exercise app is expected to terminate by itself.
    killAfter: number = 5; // Number of seconds to wait before killing the exercise app if it doesn't terminate by itself.
    interactive: boolean = false; // True if the exercise requires user actions for running (like using the Art Debugger).

    constructor(name: string, path: string) {
        this.name = name;
        this.dataFolder = path;        
    }

    // Validate that the config property is of the expected type. 
    // If yes, set the property in the exercise object.
    // If no, throw a TypeError.    
    checkAndSetConfigProperty(config : object, property : string, expectedType : string) {
        if (config[property]) {
            let actualType : string = typeof config[property];
            if (actualType == 'object' && Array.isArray(config[property])) {
                actualType = 'string[]'; // Assume string array for empty arrays
                if (config[property].length > 0) {
                    actualType = typeof config[property][0] + '[]';
                }                                
            }
            if (actualType != expectedType) {
                throw new TypeError(`Property "${property}" in exercise.json for exercise "${this.name}" is of type "${actualType}" but should be "${expectedType}".`);
            }
            this[property] = config[property];
        }
    }

    // Complete the exercise
    complete() : boolean {        
        this.completed = getTimestamp();

        try {
            fs.writeFileSync(`${this.dataFolder}/.completed`, this.completed, 'utf8');
        }
        catch (err) {
            logMessage('Failed to mark exercise ' + this.name + " as completed: " + err);   
            return false;      
        }

        return true;
    }

    // Reopen the exercise
    reopen() : boolean {        
        this.completed = '';

        try {
            fs.unlinkSync(`${this.dataFolder}/.completed`);
        }
        catch (err) {
            logMessage('Failed to reopen exercise ' + this.name + ": " + err);
            return false;
        }

        return true;
    }
}