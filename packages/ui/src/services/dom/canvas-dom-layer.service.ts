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

import { type IPosition, Tools } from '@univerjs/core';
import { BehaviorSubject, type Observable } from 'rxjs';

export interface IDomLayer {
    position: IPosition;
    position$: Observable<IPosition>;
}

export class CanvasDomLayerService {
    private _domLayerMap = new Map<string, IDomLayer>();
    private _domLayers$ = new BehaviorSubject<[string, IDomLayer][]>([]);

    domLayers$ = this._domLayers$.asObservable();

    get domLayers() {
        return Array.from(this._domLayerMap.entries());
    }

    private _notice() {
        this._domLayers$.next(Array.from(this._domLayerMap.entries()));
    }

    addDomLayer(item: IDomLayer): string {
        const id = Tools.generateRandomId();
        this._domLayerMap.set(id, item);
        this._notice();
        return id;
    }

    removeDomLayer(id: string): void {
        if (this._domLayerMap.delete(id)) {
            this._notice();
        }
    }

    removeAll(): void {
        this._domLayerMap.clear();
        this._notice();
    }
}