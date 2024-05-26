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

import type { IRange, Workbook } from '@univerjs/core';
import { ICommandService, IUniverInstanceService, UniverInstanceType } from '@univerjs/core';
import { IDefinedNamesService } from '@univerjs/engine-formula';
import type { ISetSelectionsOperationParams } from '@univerjs/sheets';
import { NORMAL_SELECTION_PLUGIN_NAME, SetSelectionsOperation, SetWorksheetActiveOperation } from '@univerjs/sheets';
import type { HyperLinkType } from '@univerjs/sheets-hyper-link/types/enums/hyper-link-type.js';

export class SheetsHyperLinkResolverService {
    constructor(
        @IUniverInstanceService private _univerInstanceService: IUniverInstanceService,
        @ICommandService private _commandService: ICommandService,
        @IDefinedNamesService private _definedNamesService: IDefinedNamesService
    ) {}

    parseHyperLink(type: HyperLinkType, url: string) {}

    async navigateToRange(unitId: string, subUnitId: string, range: IRange) {
        if (await this.navigateToSheet(unitId, subUnitId)) {
            await this._commandService.executeCommand(SetWorksheetActiveOperation.id, { unitId, subUnitId });

            this._commandService.executeCommand(
                SetSelectionsOperation.id,
                {
                    unitId,
                    subUnitId,
                    pluginName: NORMAL_SELECTION_PLUGIN_NAME,
                    selections: [{
                        primary: {
                            ...range,
                            actualColumn: range.startColumn,
                            actualRow: range.startRow,
                        },
                        range,
                    }],
                } as ISetSelectionsOperationParams
            );
        }
    }

    async navigateToSheet(unitId: string, subUnitId: string) {
        const workbook = this._univerInstanceService.getUnit<Workbook>(unitId, UniverInstanceType.UNIVER_SHEET);
        if (!workbook) {
            return false;
        }
        const worksheet = workbook.getSheetBySheetId(subUnitId);

        if (worksheet?.getSheetId() === subUnitId) {
            return true;
        }

        return await this._commandService.executeCommand(SetWorksheetActiveOperation.id, { unitId, subUnitId });
    }

    async navigateToDefineName(unitId: string, rangeid: string) {
        this._definedNamesService.focusRange(unitId, rangeid);
        return true;
    }

    async navigateToOtherWebsite(url: string) {
        window.open(url, '_blank', 'noopener noreferrer');
    }
}