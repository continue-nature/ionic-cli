import { CommandLineInputs, CommandLineOptions, MetadataGroup } from '@ionic/cli-framework';
import { stripAnsi } from '@ionic/cli-framework/utils/format';
import { findClosestOpenPort } from '@ionic/utils-network';

import { CommandMetadata, ReactServeOptions, ServeDetails } from '../../../definitions';
import { input, strong } from '../../color';
import { BIND_ALL_ADDRESS, DEFAULT_ADDRESS, LOCAL_ADDRESSES, SERVE_SCRIPT, ServeCLI, ServeRunner, ServeRunnerDeps } from '../../serve';

export class ReactServeRunner extends ServeRunner<ReactServeOptions> {
  constructor(protected readonly e: ServeRunnerDeps) {
    super();
  }

  async getCommandMetadata(): Promise<Partial<CommandMetadata>> {
    return {
      description: `
    ${input('ionic serve')} uses React Scripts. See the ${input('create-react-app')} docs[^cra-build-docs] for explanations. This command interprets the arguments to environment variables supported by React Scripts.
      `,
      footnotes: [
        {
          id: 'cra-build-docs',
          url: 'https://facebook.github.io/create-react-app/docs/advanced-configuration',
        },
      ],
      options: [
        {
          name: 'https',
          summary: 'Use HTTPS for the dev server',
          type: Boolean,
        },
        {
          name: 'react-editor',
          summary: `Specify the editor for app crash links.`,
          type: String,
        },
        {
          name: 'ci',
          summary: `Treat all warnings as build failures. Also makes the test runner non-watching.`,
          type: Boolean,
        },
        {
          name: 'livereload',
          summary: 'Do not spin up dev server--just serve files',
          type: Boolean,
          default: true,
          groups: [MetadataGroup.HIDDEN],
        },
      ],
      groups: [MetadataGroup.BETA],
    };
  }

  createOptionsFromCommandLine(inputs: CommandLineInputs, options: CommandLineOptions): ReactServeOptions {
    const baseOptions = super.createOptionsFromCommandLine(inputs, options);
    const ci = options['ci'] ? Boolean(options['ci']) : undefined;
    const https = options['https'] ? Boolean(options['https']) : undefined;
    const reactEditor = options['reactEditor'] ? String(options['reactEditor']) : undefined;

    return {
      ...baseOptions,
      ci,
      https,
      reactEditor,
    };
  }

  modifyOpenURL(url: string, options: ReactServeOptions): string {
    return url;
  }

  async serveProject(options: ReactServeOptions): Promise<ServeDetails> {
    const [externalIP, availableInterfaces] = await this.selectExternalIP(options);

    const port = options.port = await findClosestOpenPort(options.port);

    const reactScripts = new ReactServeCLI(this.e);
    await reactScripts.serve(options);

    return {
      custom: reactScripts.resolvedProgram !== reactScripts.program,
      protocol: options.https ? 'https' : 'http',
      localAddress: 'localhost',
      externalAddress: externalIP,
      externalNetworkInterfaces: availableInterfaces,
      port,
      externallyAccessible: ![BIND_ALL_ADDRESS, ...LOCAL_ADDRESSES].includes(externalIP),
    };
  }
}

export class ReactServeCLI extends ServeCLI<ReactServeOptions> {
  readonly name = 'React Scripts';
  readonly pkg = 'react-scripts';
  readonly program = 'react-scripts';
  readonly prefix = 'react-scripts';
  readonly script = SERVE_SCRIPT;
  protected chunks = 0;

  async serve(options: ReactServeOptions): Promise<void> {
    this.on('compile', chunks => {
      if (chunks > 0) {
        this.e.log.info(`... and ${strong(chunks.toString())} additional chunks`);
      }
    });

    return super.serve(options);
  }

  protected stdoutFilter(line: string): boolean {
    if (this.resolvedProgram !== this.program) {
      return super.stdoutFilter(line);
    }

    const strippedLine = stripAnsi(line);

    if (strippedLine.includes('Compiled successfully')) {
      this.emit('ready');
      return false;
    }

    if (strippedLine.match(/.*chunk\s{\d+}.+/)) {
      this.chunks++;
      return false;
    }

    if (strippedLine.includes('Compiled successfully')) {
      this.emit('compile', this.chunks);
      this.chunks = 0;
    }

    return true;
  }

  protected async buildArgs(options: ReactServeOptions): Promise<string[]> {
    const { pkgManagerArgs } = await import('../../utils/npm');

    if (this.resolvedProgram === this.program) {
      return ['start'];
    } else {
      const [, ...pkgArgs] = await pkgManagerArgs(this.e.config.get('npmClient'), { command: 'run', script: this.script });
      return pkgArgs;
    }
  }

  protected async buildEnvVars(options: ReactServeOptions): Promise<NodeJS.ProcessEnv> {
    const envVars: NodeJS.ProcessEnv = {};

    envVars.BROWSER = 'none';

    /*
      By default, CRA binds to localhost,
      but if you specify it, it puts a warning in the console,
      so don't set the HOST if the address is set to 'localhost'
    */
    if (options.address !== DEFAULT_ADDRESS) {
      envVars.HOST = options.address;
    }

    envVars.PORT = String(options.port);
    envVars.HTTPS = (options.https === true) ? 'true' : 'false';
    envVars.CI = (options.ci === true) ? 'true' : 'false';
    if (options.reactEditor) {
      envVars.REACT = options.reactEditor;
    }

    return envVars;
  }
}
