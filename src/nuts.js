/*
 * @function createRuntime
 * @param env {obj} As in given synopsis.
 * @return {class} representing Nuts compiler and virtual machine with four methods of
 *   @method load
 *   @method run
 *   @method ended
 *   @method unload
 *
   createRuntime: (
      env: object {
         putChar(char_: string) => undefined,
         async getChar(onWait: () => undefined) => char,
         randByte() => number,
         log(text: string) => undefined,
         error(text: string) => undefined,
         async sleep() => boolean
      }
   ) => class extends null {
      static load(code: string) => undefined,
      static async run([step: number = Infinity]) => undefined,
      static ended() => boolean,
      static unload() => undefined
   }
*/
const createRuntime = env => {
  /**
   * States for I/O.
   *
   * @charcode putCode {integer >=0}
   * @description Character code to output to stdout.
   *
   * @state putState {0|1|2|3|4}
   * @description Represents UTF-8 state.
   * @dependedBy @function put_
   *
   * @charcode getCode {integer>=0}
   * @description Character code obtained from stdin.
   *
   * @state getState {integer 0..3}
   * @description Represents UTF-8 state.
   */
  let putCode = 0,
    putState = 0,
    getCode = 0,
    getState = 0;

  const
    // Private functions.
    /**
     * @function put_
     * @param number {integer of 0<=n<=255} Representing a byte of UTF-8 character.
     * @description When an UTF-8 character is constructed it is output to stdout.
     * @return {bool} Is the given @param number a valid byte to construct an UTF-8 character?
     */
    put_ = number => {
      if (number > 0xff) return false;
      if (!putState) {
        if ((number & 0x80) === 0x00) {
          putCode = number;
        } else if ((number & 0xe0) === 0xc0) {
          putCode = (number ^ 0xc0) << 6;
          if ((putCode & 0x780) === 0x000) return false;
          putState = 1;
        } else if ((number & 0xf0) === 0xe0) {
          putCode = (number ^ 0xe0) << 12;
          putState = 2;
        } else if ((number & 0xf8) === 0xf0) {
          putCode = (number ^ 0xf0) << 18;
          putState = 4;
        } else return false;
      } else if ((number & 0xc0) === 0x80) {
        switch (putState) {
          case 1:
            putCode |= number ^ 0x80;
            putState = 0;
            break;
          case 2:
            putCode |= (number ^ 0x80) << 6;
            if ((putCode & 0xf800) === 0x0000) return false;
            putState = 1;
            break;
          case 3:
            putCode |= (number ^ 0x80) << 6;
            putState = 1;
            break;
          default:
            putCode |= (number ^ 0x80) << 12;
            if ((putCode & 0x1f0000) === 0x000000) return false;
            putState = 3;
        }
      } else return false;
      if (!putState) {
        env.putChar(String.fromCodePoint(putCode));
      }
      return true;
    },

    /**
     * @async @function get_
     * @return {integer 0<=n<=255|NaN} A byte of an UTF-8 character.
     * @description From stdin.
     * @XXX EOF is NaN... but nothing is dealing with NaN....
     */
    get_ = async () => {
        switch (getState) {
          case 0: {
            const char_ = await env.getChar(() => env.log(dump()));
            if (!char_.length) return NaN;
            getCode = char_.codePointAt(0);
          }
          if (getCode & 0x1f0000) {
            getState = 3;
            return (getCode >> 18) & 0x07 | 0xf0;
          } else if (getCode & 0xf800) {
            getState = 2;
            return (getCode >> 12) & 0x0f | 0xe0;
          } else if (getCode & 0x780) {
            getState = 1;
            return (getCode >> 6) & 0x1f | 0xc0;
          } else return getCode;
          case 1:
            getState = 0;
            return getCode | 0x80;
          case 2:
            getState = 1;
            return (getCode >> 6) | 0x80;
          default:
            getState = 2;
            return (getCode >> 12) | 0x80;
        }
      },

      /**
       * @function random_
       * @return {integer 0<=n<=255}
       */
      random_ = () => env.randByte();

  /**
   * Objects representing Nuts.
   */
  const
    /**
     * Nuts Tokens.
     * @usage Object.create(Token);
     */
    /**
     * @Token function_
     * @param body {null|Token}
     * @description Represents a lambda function.
     */
    function_ = {
      body: null
    },
    /**
     * @Token null_
     * @description Argument for built-in functions.
     */
    null_ = {},
    /**
     * @Token argument
     * @param index {>=0}
     * @description Argument for function. @param index means n'th depth
     */
    argument = {
      index: 0
    },
    /**
     * @Token application
     * @param function {null|Token} Function to apply.
     * @param argument {null|Token} What to be applied to the function.
     */
    application = {
      function: null,
      argument: null
    },

    /**
     * @Token put
     * @description `application{function: put, argument: church_number}` to `putN{number: N}`.
     */
    put = {},

    /**
     * @Token putN
     * @description `application{function: putN{number: N}, argument: null_}` to `null_`, with side effect of `put_(N)`.
     */
    putN = {
      number: 0
    },

    /**
     * @Token increment
     * @dependedBy @function toNumber
     */
    increment = {},

    /**
     * @Token get
     * @description `application{function: get, argument: null_}` to `church_number` such that original number is 0<=n<=255 which is taken from @function get_.
     */
    get = {},

    /**
     * @Token random
     * @description `application{function: get, argument: null_}` to `church_number` such that original number is 0<=n<=255 which is taken from @function random_.
     */
    random = {},

    /**
     * Keys.
     * @dependedBy @variable keys
     */
    funcBody = 'body',
    appFunc = 'function',
    appArg = 'argument';

  /**
   * Nuts virtual machine.
   *
   */

  /**
   * Nuts virtual machine components.
   * @variable root {null|Token}
   * @description  IDK.
   *
   * @variable current {null|Token}
   * @description IDK.
   *
   * @variable stack
   * @dependedBy @function parse
   *
   * @variable keys
   * @dependedBy @function toNumber, @function exec
   */
  let root = null,
    current = null,
    stack = [],
    keys = [];

  const
    /**
     * Functions for Nuts virtual machine.
     */

    /**
     * @function parse
     * @description Compile the given Nuts source.
     * @param code {string}
     * @return {undefined|object}
     *   {undefined} represents successful compilation.
     *   {object} represents error.
     *     @member message
     *     @member line
     *     @member column
     */
    parse = code => {
      // @var stack shall contain function_ and application
      const len = code.length,
        stack = [];
      let line = 1,
        column = 1;

      // var i is index of code
      for (let i = 0, nest = 0; i < len; i++) {
        let node;
        switch (code[i]) {
          case '\'':
            nest++;
            stack.push(Object.create(function_));
            column++;
            continue;
          case '"':
            node = Object.create(null_);
            column++;
            break;
          case '.': {
            let count = 1;
            while (++i < len) {
              if (code[i] !== '.') {
                i--;
                break;
              }
              count++;
            }
            if (count > nest) return {
              message: 'no corresponding function to the argument',
              line,
              column
            };
            (node = Object.create(argument)).index = count - 1;
            column += count;
            break;
          }
          case ',':
            stack.push(Object.create(application));
            column++;
            continue;
          case ':': {
            let count = 1;
            while (++i < len) {
              if (code[i] !== ':') {
                i--;
                break;
              }
              count++;
            }
            switch (count) {
              case 1:
                node = Object.create(put);
                break;
              case 2:
                node = Object.create(get);
                break;
              case 3:
                node = Object.create(random);
                break;
              default:
                return {
                  message: 'no corresponding builtin function', line, column
                };
            }
            column += count;
            break;
          }
          case ';':
            while (++i < len) {
              switch (code[i]) {
                case '\r':
                  if (code[i + 1] === '\n') {
                    i++;
                  }
                case '\n':
                  break;
                default:
                  continue;
              }
              break;
            }
            line++;
            column = 1;
            continue;
          case ' ':
          case '\t':
            column++;
            continue;
          case '\r':
            if (code[i + 1] === '\n') {
              i++;
            }
          case '\n':
            line++;
            column = 1;
            continue;
          default:
            return {
              message: 'unexpected character', line, column
            };
        }

        for (;;)
          if (stack.length) {
            const item = stack.pop();
            if (Object.getPrototypeOf(item) === function_) {
              item.body = node;
              nest--;
              node = item;
            } else {
              if (item.function === null) {
                item.function = node;
                stack.push(item);
                break;
              } else {
                item.argument = node;
                node = item;
              }
            }
          } else {
            while (++i < len) {
              switch (code[i]) {
                case '\'':
                case '"':
                case '.':
                case ',':
                case ':':
                  return {
                    message: 'unexpected token', line, column
                  };
                case ';':
                  while (++i < len) {
                    switch (code[i]) {
                      case '\r':
                        if (code[i + 1] === '\n') {
                          i++;
                        }
                      case '\n':
                        break;
                      default:
                        continue;
                    }
                    break;
                  }
                  line++;
                  column = 1;
                  continue;
                case ' ':
                case '\t':
                  column++;
                  continue;
                case '\r':
                  if (code[i + 1] === '\n') {
                    i++;
                  }
                case '\n':
                  line++;
                  column = 1;
                  continue;
                default:
                  return {
                    message: 'unexpected character', line, column
                  };
              }
            }

            // Success.
            root = node;
            if (Object.getPrototypeOf(root) === application) {
              current = root;
            }
            return;
          }
      }
      return {
        message: 'unexpected end of code',
        line,
        column
      };
    }, // @function parse

    /**
     * @function clone
     * @param node
     * @description ???
     */
    clone = node => {
      const stack = [];
      for (let node_ = node;;) {
        switch (Object.getPrototypeOf(node_)) {
          case function_:
            stack.push(Object.create(function_));
            node_ = node_.body;
            continue;
          case application: {
            const cloned = Object.create(application);
            cloned.argument = node_.argument;
            stack.push(cloned);
            node_ = node_.function;
            continue;
          }
        }
        for (;;)
          if (stack.length) {
            const item = stack.pop();
            if (Object.getPrototypeOf(item) === function_) {
              item.body = node_;
              node_ = item;
            } else {
              if (item.function === null) {
                item.function = node_;
                stack.push(item);
                node_ = item.argument;
                break;
              } else {
                item.argument = node_;
                node_ = item;
              }
            }
          }
        else return node_;
      }
    },

    /**
     * Apply a function to given argument.
     */
    substituteArg = (func, arg) => {
      const stack = [];
      for (let node = func, key = funcBody, nest = 0, first = true;;) {
        const node_ = node[key];
        switch (Object.getPrototypeOf(node_)) {
          case function_:
            node = node_;
            key = funcBody;
            stack.push(node_);
            nest++;
            continue;
          case argument:
            if (node_.index === nest) {
              if (first) {
                node[key] = arg;
                first = false;
              } else {
                node[key] = clone(arg);
              }
            }
            break;
          case application:
            node = node_;
            key = appFunc;
            stack.push(node_);
            continue;
        }
        for (;;)
          if (stack.length) {
            const item = stack.pop();
            if (Object.getPrototypeOf(item) === function_) {
              nest--;
            } else {
              node = item;
              key = appArg;
              break;
            }
          }
        else return;
      }
    },

    toNumber = church => {
      let node = Object.create(application);
      {
        let node_ = node.function = Object.create(application);
        node_.function = church;
        node_.argument = Object.create(increment);
        node.argument = 0;
      }
      church = null;
      const stack = [],
        keys = [];
      for (let node_ = node, func, arg;;) {
        func = node_.function;
        const funcKind = Object.getPrototypeOf(func);
        if (funcKind === application) {
          stack.push(node_);
          keys.push(appFunc);
          node_ = func;
          continue;
        }
        arg = node_.argument;
        const argKind = Object.getPrototypeOf(arg);
        if (argKind === application) {
          stack.push(node_);
          keys.push(appArg);
          node_ = arg;
          continue;
        }
        let result;
        switch (funcKind) {
          case function_:
            substituteArg(func, arg);
            result = func.body;
            if (Object.getPrototypeOf(result) === application) {
              if (stack.length) {
                node_ = stack[stack.length - 1][keys[keys.length - 1]] = result;
                continue;
              } else {
                node_ = node = result;
                continue;
              }
            }
            break;
          case increment:
            if (argKind === Number.prototype) {
              result = arg + 1;
              break;
            }
          default:
            return NaN;
        }
        if (stack.length) {
          const item = stack.pop();
          item[keys.pop()] = result;
          node_ = item;
        } else return +result;
      }
    },

    toChurch = number => {
      const node = Object.create(function_);
      let node_ = node.body = Object.create(function_);
      if (number) {
        ((node_ = node_.body = Object.create(application)).function = Object.create(argument)).index = 1;
        for (let i = 1; i < number; i++) {
          ((node_ = node_.argument = Object.create(application)).function = Object.create(argument)).index = 1;
        }
        (node_.argument = Object.create(argument)).index = 0;
      } else {
        (node_.body = Object.create(argument)).index = 0;
      }
      return node;
    },

    /**
     * @function exec
     * @description Run the compiled program for one step.
     * @return {undefined|Object}
     *   {undefined} for success,
     *   @member message for error message.
     */
    exec = async () => {
        const func = current.function,
          funcKind = Object.getPrototypeOf(func);
        if (funcKind === application) {
          stack.push(current);
          keys.push(appFunc);
          current = func;
          return;
        }
        const arg = current.argument,
          argKind = Object.getPrototypeOf(arg);
        if (argKind === application) {
          stack.push(current);
          keys.push(appArg);
          current = arg;
          return;
        }
        let result;
        switch (funcKind) {
          case function_:
            substituteArg(func, arg);
            result = func.body;
            if (Object.getPrototypeOf(result) === application) {
              if (stack.length) {
                current = stack[stack.length - 1][keys[keys.length - 1]] = result;
              } else {
                current = root = result;
              }
              return;
            }
            break;
          case put: {
            const number = toNumber(arg);
            result = Object.create(putN);
            if (Number.isNaN(result.number = number)) {
              if (stack.length) {
                stack.pop()[keys.pop()] = result;
              } else {
                root = result;
              }
              return {
                message: 'the argument was not a Church numeral'
              };
            }
            break;
          }
          case putN:
            if (argKind !== null_) return {
              message: 'the argument was not null'
            };
            if (!put_(func.number)) return {
              message: 'invalid UTF-8 sequence'
            };
            result = Object.create(null_);
            break;
          case get: {
            if (argKind !== null_) return {
              message: 'the argument was not null'
            };
            const number = await get_();
            if (Number.isNaN(number)) return {
              message: 'program aborted'
            };
            result = toChurch(number);
            break;
          }
          case random:
            if (argKind !== null_) return {
              message: 'the argument was not null'
            };
            result = toChurch(random_());
            break;
          default:
            return {
              message: 'null is not a function'
            };
        }
        if (stack.length) {
          const item = stack.pop();
          item[keys.pop()] = result;
          current = item;
        } else {
          root = result;
          current = null;
        }
      },

      /**
       * @function dump
       * @description Compiled program to Nuts source representation.
       * @return {string} of Nuts source representation.
       */
      dump = () => {
        const stack = [];
        for (let node = root, text = '';;) {
          switch (Object.getPrototypeOf(node)) {
            case function_:
              text += '\'';
              node = node.body;
              continue;
            case null_:
              text += '"';
              break;
            case argument:
              if (text.endsWith('.')) {
                text += ' ';
              }
              text += '.'.repeat(node.index + 1);
              break;
            case application:
              text += node === current ? '[,' : ',';
              stack.push(node);
              node = node.function;
              continue;
            case put:
              if (text.endsWith(':')) {
                text += ' ';
              }
              text += ':';
              break;
            case get:
              if (text.endsWith(':')) {
                text += ' ';
              }
              text += '::';
              break;
            case random:
              if (text.endsWith(':')) {
                text += ' ';
              }
              text += ':::';
              break;
            default:
              text += '{' + node.number + '}';
          }
          for (;;)
            if (stack.length) {
              const item = stack.pop();
              if (item) {
                if (item === current) {
                  stack.push(null);
                }
                node = item.argument;
                break;
              } else {
                text += ']';
              }
            }
          else return text;
        }
      };

  // Finally list of public methods
  return class extends null {
    /**
     * @method load
     * @param code {string}
     * @param do_dump {bool}
     * @description Compiler. The compiled Nuts program can be run with @function run.
     */
    static load(code, do_dump = false) {
      const error = parse(code);
      if (error) {
        env.error(`syntax error: ${error.message} (${error.line}, ${error.column})`);
        return;
      }
      if (do_dump) {
        env.log(dump());
      }
    }

    /**
     * @async @method run
     * @param step {integer|Number.Infinity}
     * @param do_dump {bool}
     * @description Run the compiled Nuts program for given steps.
     */
    static async run(step = Infinity, do_dump = false) {
      for (;;) {
        if (current === null) break;
        const error = await exec();
        if (error) {
          env.error(`runtime error: ${error.message}`);
          env.log(dump());
          this.unload();
          return;
        }
        if (!--step) break;
        const aborted = await env.sleep();
        if (aborted) {
          env.error(`runtime error: program aborted`);
          env.log(dump());
          this.unload();
          return;
        }
      }
      if (do_dump) {
        env.log(dump());
      }
    }

    /**
     * @method ended
     * @return {bool}
     * @description Has the compiled Nuts program halted?
     */
    static ended() {
      return current === null;
    }

    /**
     * @method unload
     * @description Reset the compiled Nuts program to initial state
     * @example
     * ```js
     * const foo = createRuntime(env);
     * foo.load(src);
     * foo.run();
     * foo.unload();
     * foo.run();
     * ```
     */
    static unload() {
      root = current = null;
      stack.length = 0;
      putCode = putState = getCode = getState = 0;
    }
  }; // return class extends null
}; // @function createRuntime

module.exports = createRuntime;
