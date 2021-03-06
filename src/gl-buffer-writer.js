import { GLrefCreators } from './common/gl-commands';
import { getCommandTypes, GL_REF_KEY, getTypeOfArray, getTypeOfArrayByNum } from './common/util';
import { UID, isString } from './common/misc';
import { GLref, GLstring, GLarraybuffer, GLimage, ArrayBufferTypes, GLboolean } from './common/gl-types';

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder('utf-8') : null;

export default class GLBufferWriter {
    constructor(options = {}) {
        this.options = options;
        this.refPrefix = options.refPrefix;
        this.reset();
    }

    /**
     * Add a webgl command and arguments
     * @param {String} name
     * @param {Any[]} args
     */
    addCommand(name, ...args) {
        const commandTypes = getCommandTypes(name, ...args);
        if (!commandTypes) {
            if (this.options.debug) {
                // command ignored
                console.log(`[addCommand] ignore command ${name}`);
            }
            return this;
        }
        let l = commandTypes.argTypes.length;
        if (commandTypes.returnType) {
            l += 1;
        }
        if (l !== args.length) {
            throw new Error(`[addCommand] wrong argument number ${name}`);
        }
        this._saveCommand(commandTypes, name, ...args);
        return this;
    }

    clearCommands() {
        this.commands = [];
        this.valueBuffers = [];
        return this;
    }

    reset() {
        this.clearCommands();
        this.refMap = {};
        return this;
    }

    getBuffer() {
        return {
            refPrefix : this.refPrefix || '',
            commands : new Uint32Array(this.commands),
            values : this.valueBuffers
        };
    }

    _saveCommand(commandTypes, name, ...args) {
        // const commandTypes = getCommandTypes(name, ...args);
        if (GLrefCreators[name]) {
            const obj = args[args.length - 1];
            if (Array.isArray(obj)) {
                obj.forEach(o => {
                    if (!o[GL_REF_KEY]) {
                        const key = UID();
                        o[GL_REF_KEY] = key;
                        this.refMap[key] = o;
                    }
                });
            } else if (!obj[GL_REF_KEY]) {
                const key = UID();
                obj[GL_REF_KEY] = key;
                this.refMap[key] = obj;
            }
        }
        const { bufferTypes, size } = this._getBufferTypes(commandTypes, ...args);
        const buffer = this._writeArgValues(args, commandTypes, bufferTypes, size);
        //bufferTypes may be updated by _writeArgValues
        this._writeCommand(commandTypes, bufferTypes);
        this.valueBuffers.push(buffer);
    }

    /**
     * write command and its buffer types to command buffer.
     * the structure: (each [] is an uint32 number)
     * [command number] | [buffer type number][buffer size] | [buffer type number][buffer size] | ....
     *                  |------optional------------------------------------------------|
     * @param {Any[]} commandTypes
     * @param {Any[]} bufferTypes
     */
    _writeCommand(commandTypes, bufferTypes) {
        //command num
        this.commands.push(commandTypes.num);
        if (bufferTypes) {
            //push in buffer types
            bufferTypes.forEach(d => {
                this.commands.push(d);
            });
        }
    }

    /**
     * write argument values
     * the structure(each [] is an argument value, it's length is decided by argument type):
     * [arg00][arg01][arg02] | [arg10][arg11][arg12] | .....
     *    command0's args         command1's args      ...
     * @param {Any[]} values argument values
     * @param {Object[]} commandTypes command types
     * @param {Object[]} bufferTypes buffer argument's types
     * @param {Number} size value's buffer size in bytes
     */
    _writeArgValues(values, commandTypes, bufferTypes, size) {
        const buf = new ArrayBuffer(size);
        if (values.length === 0) {
            return buf;
        }
        const view = new DataView(buf);

        let pointer = 0;
        let btPointer = 0; //bufferTypes's pointer
        const types = commandTypes.argTypes;
        let i = 0;
        for (const l = types.length; i < l; i++) {
            const type = types[i];
            let value = values[i];
            if (type === GLref) {
                value = value[GL_REF_KEY];
            }
            let bytesCount = type.bytesCount;
            if (type === GLarraybuffer) {
                //write array or string value
                this._writeBuffer(buf, value, bufferTypes[btPointer++], pointer, bufferTypes[btPointer]);
                bytesCount = bufferTypes[btPointer++];
            } else if (type === GLstring) {
                if (textEncoder) {
                    const strBytes = bufferTypes[btPointer];
                    const arr = new Uint8Array(buf, pointer, strBytes.byteLength);
                    arr.set(strBytes);
                    bytesCount = strBytes.byteLength;
                    //replace string array with bytesCount that player needs
                    bufferTypes[btPointer++] = bytesCount;
                } else {
                    this._writeBuffer(buf, value, ArrayBufferTypes.GLUint16Array.num, pointer, bufferTypes[btPointer]);
                    bytesCount = bufferTypes[btPointer++];
                }
            } else if (type === GLimage) {
                const w = bufferTypes[btPointer++],
                    h = bufferTypes[btPointer++];
                this._writeBuffer(buf, value, ArrayBufferTypes.GLUint8ClampedArray.num, pointer, w * h * 4);
                bytesCount = w * h * 4;
            } else {
                if (type === GLboolean) {
                    value = value ? 1 : 0;
                }
                //write common values
                view['set' + type.type](pointer, value);
            }
            pointer += bytesCount;
        }
        const returnType = commandTypes.returnType;
        if (returnType) {
            if (Array.isArray(returnType)) {
                const rValues = values[i];
                const rtype = returnType[0];

                rValues.forEach(value => {
                    const v = rtype === GLref ? value[GL_REF_KEY] : value;
                    view['set' + rtype.type](pointer, v);
                    pointer += rtype.bytesCount;
                });
            } else {
                //last argument
                const value = returnType === GLref ? values[i][GL_REF_KEY] : values[i];
                view['set' + returnType.type](pointer, value);
            }
        }
        return buf;
    }

    /**
     * write array or string type argument value into arraybuffer
     * @param {ArrayBuffer} buffer
     * @param {Any} value
     * @param {Number} type ArrayBufferType's num
     * @param {Number} pointer
     * @param {Number} size
     */
    _writeBuffer(buffer, value, type, pointer, size) {
        const arrType = getTypeOfArrayByNum(type);
        const arr = new arrType.type(buffer, pointer, size / arrType.type.BYTES_PER_ELEMENT);
        if (isString(value)) {
            for (let i = 0, l = value.length; i < l; i++) {
                arr[i] = value.charCodeAt(i);
            }
        } else {
            arr.set(value);
        }
    }

    /**
     * Get array type or string type definitions in the given arguments
     * @param {Object} commandTypes
     * @param {Any[]} args
     */
    _getBufferTypes(commandTypes, ...args) {
        let size = 0;
        const bufferTypes = [];
        let bytesCount;

        const types = commandTypes.argTypes;
        for (let i = 0, l = types.length; i < l; i++) {
            if (types[i] === GLarraybuffer) {
                const arr = args[i];
                const arrType = getTypeOfArray(arr);
                bytesCount = arr.length * arrType.type.BYTES_PER_ELEMENT;
                //[arr type][bytes count]
                bufferTypes.push(arrType.num, bytesCount);
            } else if (types[i] === GLstring) {
                const str = args[i];
                if (textEncoder) {
                    const arr = textEncoder.encode(str);
                    bytesCount = arr.byteLength;
                    bufferTypes.push(arr);
                } else {
                    bytesCount = str.length * 2;
                    //[bytes count]
                    bufferTypes.push(bytesCount);
                }
            } else if (types[i] === GLimage) {
                const img = args[i];
                const imgData = this._readImage(img);
                bytesCount = imgData.data.length;
                const w = imgData.width,
                    h = imgData.height;
                //[width][height]
                bufferTypes.push(w, h);
            } else {
                bytesCount = types[i].bytesCount;
            }
            size += bytesCount;
        }

        const returnType = commandTypes.returnType;
        if (returnType) {
            if (Array.isArray(returnType)) {
                const bytesCount =  returnType[0].bytesCount;
                size += bytesCount * args[args.length - 1].length;
            } else {
                size += returnType.bytesCount;
            }
        }

        return {
            bufferTypes,
            size
        };
    }

    _readImage(img) {
        if (img instanceof ImageData) {
            return img;
        }
        return null;
    }
}
