import { z } from 'zod';

const helloSchema = z.object({
  name: z.string().describe('The name of the user to greet'),
});

const helloWorldPlugin = {
  id: 'hello-world',
  name: 'Hello World',
  description: 'Sample skill plugin that registers a greeting tool.',

  register(api: any) {
    api.registerTool({
      name: 'hello_world',
      description: 'Greets the user with a custom message.',
      parameters: helloSchema,
      execute: async ({ name }: z.infer<typeof helloSchema>) => {
        return `Hello, ${name}! Welcome to Adytum.`;
      },
    });
  },
};

export default helloWorldPlugin;
