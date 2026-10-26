import { IoAdapter } from '@nestjs/platform-socket.io';

/** Socket.IO with the same allowed browser origins as the REST API. */
export class RealtimeAdapter extends IoAdapter {
  constructor(
    app: ConstructorParameters<typeof IoAdapter>[0],
    private readonly corsOrigin: string[] | boolean,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: Parameters<IoAdapter['createIOServer']>[1]) {
    return super.createIOServer(port, { ...options, cors: { origin: this.corsOrigin } } as typeof options);
  }
}
