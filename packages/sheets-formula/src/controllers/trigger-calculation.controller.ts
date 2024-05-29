/**
 * Copyright 2023-present DreamNum Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ICommandInfo, IUnitRange } from '@univerjs/core';
import { Disposable, ICommandService, LifecycleStages, OnLifecycle, throttle } from '@univerjs/core';
import type {
    IDirtyUnitFeatureMap,
    IDirtyUnitOtherFormulaMap,
    IDirtyUnitSheetNameMap,
    ISetFormulaCalculationNotificationMutation,
} from '@univerjs/engine-formula';
import {
    FormulaDataModel,
    FormulaExecutedStateType,
    FormulaExecuteStageType,
    IActiveDirtyManagerService,
    SetFormulaCalculationNotificationMutation,
    SetFormulaCalculationStartMutation,
} from '@univerjs/engine-formula';
import type { ISetRangeValuesMutationParams } from '@univerjs/sheets';
import {
    ClearSelectionFormatCommand,
    INumfmtService,
    SetBorderCommand,
    SetRangeValuesMutation,
    SetStyleCommand,
} from '@univerjs/sheets';
import { IProgressService } from '@univerjs/ui';

import { Inject } from '@wendellhu/redi';

@OnLifecycle(LifecycleStages.Ready, TriggerCalculationController)
export class TriggerCalculationController extends Disposable {
    private _waitingCommandQueue: ICommandInfo[] = [];

    private _executingCommandQueue: ICommandInfo[] = [];

    private _setTimeoutKey: NodeJS.Timeout | number = -1;

    private _startExecutionTime: number = 0;

    private _formulaCalculationDoneCount: number = 0;

    private _arrayFormulaCalculationDoneCount: number = 0;

    constructor(
        @ICommandService private readonly _commandService: ICommandService,
        @IActiveDirtyManagerService private readonly _activeDirtyManagerService: IActiveDirtyManagerService,
        @Inject(INumfmtService) private readonly _numfmtService: INumfmtService,
        @Inject(FormulaDataModel) private readonly _formulaDataModel: FormulaDataModel,
        @Inject(IProgressService) private readonly _progressService: IProgressService
    ) {
        super();

        this._initialize();
    }

    private _initialize(): void {
        this._commandExecutedListener();

        this._initialExecuteFormulaProcessListener();

        this._initialExecuteFormula();
    }

    private _commandExecutedListener() {
        // const updateCommandList = [
        //     SetRangeValuesMutation.id,
        //     MoveRangeMutation.id,
        //     MoveRowsMutation.id,
        //     MoveColsMutation.id,
        //     DeleteRangeMutation.id,
        //     InsertRangeMutation.id,
        //     RemoveRowMutation.id,
        //     RemoveColMutation.id,
        //     RemoveSheetMutation.id,
        //     // SetWorksheetNameMutation.id,
        //     InsertSheetMutation.id,
        // ];

        this.disposeWithMe(
            this._commandService.onCommandExecuted((command: ICommandInfo, options) => {
                if (!this._activeDirtyManagerService.get(command.id)) {
                    return;
                }

                if (command.id === SetRangeValuesMutation.id) {
                    const params = command.params as ISetRangeValuesMutationParams;

                    if (
                        (options && options.onlyLocal === true) ||
                        params.trigger === SetStyleCommand.id ||
                        params.trigger === SetBorderCommand.id ||
                        params.trigger === ClearSelectionFormatCommand.id
                    ) {
                        return;
                    }
                }

                this._waitingCommandQueue.push(command);

                clearTimeout(this._setTimeoutKey);

                this._setTimeoutKey = setTimeout(() => {
                    this._commandService.executeCommand(
                        SetFormulaCalculationStartMutation.id,
                        {
                            ...this._generateDirty(this._waitingCommandQueue),
                        },
                        {
                            onlyLocal: true,
                        }
                    );

                    this._startExecutionTime = performance.now();

                    this._executingCommandQueue = this._waitingCommandQueue;

                    this._waitingCommandQueue = [];
                }, 100);
            })
        );
    }

    private _generateDirty(commands: ICommandInfo[]) {
        const allDirtyRanges: IUnitRange[] = [];
        const allDirtyNameMap: IDirtyUnitSheetNameMap = {};
        const allDirtyDefinedNameMap: IDirtyUnitSheetNameMap = {};
        const allDirtyUnitFeatureMap: IDirtyUnitFeatureMap = {};
        const allDirtyUnitOtherFormulaMap: IDirtyUnitOtherFormulaMap = {};

        // const numfmtItemMap: INumfmtItemMap = Tools.deepClone(this._formulaDataModel.getNumfmtItemMap());

        for (const command of commands) {
            const conversion = this._activeDirtyManagerService.get(command.id);

            if (conversion == null) {
                continue;
            }

            const params = conversion.getDirtyData(command);

            const { dirtyRanges, dirtyNameMap, dirtyDefinedNameMap, dirtyUnitFeatureMap, dirtyUnitOtherFormulaMap } = params;

            if (dirtyRanges != null) {
                allDirtyRanges.push(...dirtyRanges);
            }

            if (dirtyNameMap != null) {
                this._mergeDirtyNameMap(allDirtyNameMap, dirtyNameMap);
            }

            if (dirtyDefinedNameMap != null) {
                this._mergeDirtyNameMap(allDirtyDefinedNameMap, dirtyDefinedNameMap);
            }

            if (dirtyUnitFeatureMap != null) {
                this._mergeDirtyUnitFeatureOrOtherFormulaMap(allDirtyUnitFeatureMap, dirtyUnitFeatureMap);
            }

            if (dirtyUnitOtherFormulaMap != null) {
                this._mergeDirtyUnitFeatureOrOtherFormulaMap(allDirtyUnitOtherFormulaMap, dirtyUnitOtherFormulaMap);
            }
        }

        return {
            dirtyRanges: allDirtyRanges,
            dirtyNameMap: allDirtyNameMap,
            dirtyDefinedNameMap: allDirtyDefinedNameMap,
            dirtyUnitFeatureMap: allDirtyUnitFeatureMap,
            dirtyUnitOtherFormulaMap: allDirtyUnitOtherFormulaMap,
            // numfmtItemMap,
        };
    }

    private _mergeDirtyNameMap(allDirtyNameMap: IDirtyUnitSheetNameMap, dirtyNameMap: IDirtyUnitSheetNameMap) {
        Object.keys(dirtyNameMap).forEach((unitId) => {
            if (allDirtyNameMap[unitId] == null) {
                allDirtyNameMap[unitId] = {};
            }

            Object.keys(dirtyNameMap[unitId]!).forEach((sheetId) => {
                if (dirtyNameMap[unitId]?.[sheetId]) {
                    if (allDirtyNameMap[unitId] == null) {
                        allDirtyNameMap[unitId] = {};
                    }
                    allDirtyNameMap[unitId]![sheetId] = dirtyNameMap[unitId]![sheetId];
                }
            });
        });
    }

    private _mergeDirtyUnitFeatureOrOtherFormulaMap(
        allDirtyUnitFeatureOrOtherFormulaMap: IDirtyUnitFeatureMap | IDirtyUnitOtherFormulaMap,
        dirtyUnitFeatureOrOtherFormulaMap: IDirtyUnitFeatureMap | IDirtyUnitOtherFormulaMap
    ) {
        Object.keys(dirtyUnitFeatureOrOtherFormulaMap).forEach((unitId) => {
            if (allDirtyUnitFeatureOrOtherFormulaMap[unitId] == null) {
                allDirtyUnitFeatureOrOtherFormulaMap[unitId] = {};
            }
            Object.keys(dirtyUnitFeatureOrOtherFormulaMap[unitId]!).forEach((sheetId) => {
                if (allDirtyUnitFeatureOrOtherFormulaMap[unitId]![sheetId] == null) {
                    allDirtyUnitFeatureOrOtherFormulaMap[unitId]![sheetId] = {};
                }
                Object.keys(dirtyUnitFeatureOrOtherFormulaMap[unitId]![sheetId]).forEach((featureIdOrFormulaId) => {
                    allDirtyUnitFeatureOrOtherFormulaMap[unitId]![sheetId][featureIdOrFormulaId] =
                        dirtyUnitFeatureOrOtherFormulaMap[unitId]![sheetId]![featureIdOrFormulaId] || false;
                });
            });
        });
    }

    private _initialExecuteFormulaProcessListener() {
        /**
         * Assignment operation after formula calculation.
         */
        const debouncedFormulaPushTask = throttle(this._pushFormulaTask.bind(this), 300);
        const debouncedArrayFormulaPushTask = throttle(this._pushArrayFormulaTask.bind(this), 300);
        let startDependencyTimer: NodeJS.Timeout | null = null;
        let calculationProcessCount = 0; // Multiple calculations are performed in parallel, but only one progress bar is displayed, and the progress is only closed after the last calculation is completed.
        let formulaCalculationCount = 0;
        let arrayFormulaCalculationCount = 0;
        let needStartFormulaProgress = false;
        let needStartArrayFormulaProgress = false;

        this.disposeWithMe(
            this._commandService.onCommandExecuted((command: ICommandInfo) => {
                if (command.id !== SetFormulaCalculationNotificationMutation.id) {
                    return;
                }

                const params = command.params as ISetFormulaCalculationNotificationMutation;

                if (params.stageInfo != null) {
                    const {
                        totalFormulasToCalculate,
                        completedFormulasCount,
                        totalArrayFormulasToCalculate,
                        completedArrayFormulasCount,
                        stage,
                    } = params.stageInfo;

                    if (stage === FormulaExecuteStageType.START_DEPENDENCY) {
                        // Increment the calculation process count and assign a new ID
                        calculationProcessCount++;

                        // Clear any existing timer to prevent duplicate executions
                        if (startDependencyTimer !== null) {
                            clearTimeout(startDependencyTimer);
                            startDependencyTimer = null;
                        }

                        // If the total calculation time exceeds 1s, a progress bar is displayed. The first progress shows 5%
                        startDependencyTimer = setTimeout(() => {
                            // Ignore progress deviations, and finally the complete method ensures the correct completion of the progress
                            const taskCount = (formulaCalculationCount - this._formulaCalculationDoneCount) + (arrayFormulaCalculationCount - this._arrayFormulaCalculationDoneCount) + 100;
                            this._progressService.insertTaskCount(taskCount);
                            this._progressService.pushTask({ count: 5 });
                            startDependencyTimer = null;
                        }, 1000);
                    } else if (stage === FormulaExecuteStageType.CURRENTLY_CALCULATING) {
                        // Each start of calculation of statistics once
                        if (completedFormulasCount === 1 && !needStartFormulaProgress) {
                            needStartFormulaProgress = true;
                            formulaCalculationCount += totalFormulasToCalculate;
                        }
                        debouncedFormulaPushTask(completedFormulasCount);
                    } else if (stage === FormulaExecuteStageType.CURRENTLY_CALCULATING_ARRAY_FORMULA) {
                        if (completedArrayFormulasCount === 1 && !needStartArrayFormulaProgress) {
                            needStartArrayFormulaProgress = true;
                            arrayFormulaCalculationCount += totalArrayFormulasToCalculate;
                        }
                        debouncedArrayFormulaPushTask(completedArrayFormulasCount);
                    }

                    // if (totalArrayFormulasToCalculate > 0) {
                    // console.warn(
                    //     `Stage ${stage} Array formula.There are ${totalArrayFormulasToCalculate} functions to be executed, ${completedArrayFormulasCount} complete.`
                    // );
                    // } else {
                    // console.warn(
                    //     `Stage ${stage} .There are ${totalFormulasToCalculate} functions to be executed, ${completedFormulasCount} complete.`
                    // );
                    // }
                } else {
                    const state = params.functionsExecutedState;
                    let result = '';
                    switch (state) {
                        case FormulaExecutedStateType.NOT_EXECUTED:
                            result = 'No tasks are being executed anymore';
                            // this._waitingCommandQueue.unshift(...this._executingCommandQueue);
                            this._executingCommandQueue = [];
                            break;
                        case FormulaExecutedStateType.STOP_EXECUTION:
                            result = 'The execution of the formula has been stopped';
                            this._waitingCommandQueue.unshift(...this._executingCommandQueue);
                            this._executingCommandQueue = [];
                            break;
                        case FormulaExecutedStateType.SUCCESS:
                            result = `Formula calculation succeeded, Total time consumed: ${performance.now() - this._startExecutionTime
                            } ms`;
                            this._executingCommandQueue = [];
                            break;
                        case FormulaExecutedStateType.INITIAL:
                            result = 'Waiting for calculation';
                            this._executingCommandQueue = [];
                            break;
                    }

                    // Decrement the calculation process count
                    calculationProcessCount--;

                    if (calculationProcessCount === 0) {
                        if (startDependencyTimer) {
                            // The total calculation time does not exceed 1s, and the progress bar is not displayed.
                            clearTimeout(startDependencyTimer);
                            startDependencyTimer = null;
                        } else {
                            // Manually hide the progress bar only if no other calculations are in process
                            if (state === FormulaExecutedStateType.SUCCESS) {
                                this._progressService.complete();
                            } else if (state === FormulaExecutedStateType.STOP_EXECUTION) {
                                this._progressService.stop();
                            }

                            this._formulaCalculationDoneCount = 0;
                            this._arrayFormulaCalculationDoneCount = 0;
                            needStartFormulaProgress = false;
                            needStartArrayFormulaProgress = false;
                        }
                    }

                    console.warn(`execution result${result}`);
                }
            })
        );
    }

    private _initialExecuteFormula() {
        this._commandService.executeCommand(
            SetFormulaCalculationStartMutation.id,
            {
                commands: [],
                forceCalculation: true,
            },
            {
                onlyLocal: true,
            }
        );
    }

    /**
     * Update progress by completed count
     * @param completedCount
     */
    private _pushFormulaTask(completedCount: number) {
        const count = completedCount - this._formulaCalculationDoneCount;
        this._formulaCalculationDoneCount = completedCount;
        this._progressService.pushTask({ count });
    }

    /**
     * Update progress by completed count
     * @param completedCount
     */
    private _pushArrayFormulaTask(completedCount: number) {
        const count = completedCount - this._arrayFormulaCalculationDoneCount;
        this._arrayFormulaCalculationDoneCount = completedCount;
        this._progressService.pushTask({ count });
    }
}
