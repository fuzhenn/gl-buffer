import { isFunction } from './common/misc';
import { getCommandTypesByNum, getTypeOfArrayByNum } from './common/util';
// import { GLrefCreators, GLlocationGetters } from './common/gl-commands';
import { GLref, GLlocation, GLarraybuffer, GLstring, GLimage, GLboolean } from './common/gl-types';

const textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;

export default class GLBufferPlayer {
    constructor() {
        this.commands = [];
        this.refMap = {};
    }

    addBuffer(data) {
        this._parse(data);
        return this;
    }

    getCommands() {
        return this.commands;
    }

    playback(gl, step) {
        const commands = this.getCommands();
        commands.forEach(c => {
            const name = c.name, ref = c.command.ref;
            let rargs = this._prepareArgs(c);
            if (isFunction(step)) {
                rargs = step(name, rargs);
            }
            const result = gl[name].apply(gl, rargs);
            if (ref) {
                this.refMap[ref] = result;
            }
        });

        return this;
    }

    clearCommands() {
        this.commands = [];
    }

    reset() {
        this.clearCommands();
        this.refMap = {};
    }

    _prepareArgs(command) {
        // const name = command.name;
        const types = command.types;
        const args = command.args;
        // const isRef = command.ref;
        const result = [];
        for (let i = 0, l = types.length; i < l; i++) {
            const type = types[i];
            const v = args[i];
            if (type === GLref || type === GLlocation) {
                //a reference object or location
                result.push(this.refMap[v]);
            } else {
                result.push(v);
            }
        }
        return result;
    }

    _parse(data) {
        const commands = data.commands;

        let cPt = 0, vIdx = 0;
        while (cPt < commands.length) {
            const values = new DataView(data.values[vIdx++]);
            const c = this._readCommand(cPt, commands, values, data.refPrefix || '');
            cPt = c.cPt;
            this.commands.push(c.command);
        }
    }

    _readCommand(cPt, comBuffer, values, refPrefix)  {
        const commandNum = comBuffer[cPt++];
        const commandTypes = getCommandTypesByNum(commandNum);
        //command method name
        const name = commandTypes.name;
        //arguments
        const args = [];
        //result reference id
        // let ref = 0;
        // const isRef = GLrefCreators[name] || GLlocationGetters[name];
        const types = commandTypes.argTypes;
        let vPt = 0;
        for (let i = 0, l = types.length; i < l; i++) {
            const type = types[i];
            let bytesCount = type.bytesCount;
            if (type === GLarraybuffer) {
                //read value of array type
                //[arr type][bytes count]
                const arrType = getTypeOfArrayByNum(comBuffer[cPt++]).type;
                bytesCount = comBuffer[cPt++];
                const v = this._readArray(vPt, values.buffer, arrType, bytesCount);
                args.push(v);
            } else if (type === GLstring) {
                //read value of string
                //[bytes count]
                bytesCount = comBuffer[cPt++];
                const str = this._readString(vPt, values, bytesCount);
                args.push(str);
            } else if (type === GLimage) {
                //[width][height]
                const w = comBuffer[cPt++],
                    h = comBuffer[cPt++];
                bytesCount = w * h * 4;
                const arr = this._readArray(vPt, values.buffer, Uint8ClampedArray, bytesCount);
                const imageData = this._createImageData(arr, w, h);
                args.push(imageData);
            } else {
                //common values: int8/uint8/int16..
                let v = values[`get${type.type}`](vPt);
                if (type === GLboolean) {
                    v = !!v;
                } else if (type === GLref || type === GLlocation) {
                    v = refPrefix + v;
                }
                args.push(v);
            }
            vPt += bytesCount;
        }
        let ref = 0;
        const returnType = commandTypes.returnType;
        if (returnType) {
            if (Array.isArray(returnType)) {
                ref = [];
                const rType = returnType[0].type;
                while (vPt < values.buffer.byteLength) {
                    ref.push(refPrefix + values[`get${rType}`](vPt));
                    vPt += returnType[0].bytesCount;
                }
            } else {
                ref = refPrefix + values[`get${returnType.type}`](vPt);
                vPt += returnType.bytesCount;
            }
        }

        return {
            cPt,
            command : {
                name : name,
                types : types,
                args : args,
                ref : ref
            }
        };
    }

    _readArray(pt, values, arrType, arrSize) {
        return new arrType(values, pt, arrSize / arrType.BYTES_PER_ELEMENT);
    }

    _readString(pt, values, bytesCount) {
        if (textDecoder) {
            const arr = new Uint8Array(values.buffer, pt, bytesCount);
            return textDecoder.decode(arr);
        } else {
            const arr = new Uint16Array(values.buffer, pt, bytesCount / 2);
            return String.fromCharCode.apply(null, arr);
        }
    }

    _createImageData(arr, w, h) {
        if (isFunction(ImageData)) {
            return new ImageData(arr, w, h);
        }
        if (!this._canvas) {
            this._canvas = document.createElement('canvas');
        }
        const ctx = this._canvas.getContext('2d');
        const imgData = ctx.createImageData(w, h);
        for (let i = 0, l = arr.length; i < l; i++) {
            imgData.data[i] = arr[i];
        }
        return imgData;
    }
};
