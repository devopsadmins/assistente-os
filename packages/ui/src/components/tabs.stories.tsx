import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";

export const Default = () => (
  <Tabs defaultValue="login" style={{ width: 320 }}>
    <TabsList>
      <TabsTrigger value="login">Entrar</TabsTrigger>
      <TabsTrigger value="signup">Criar conta</TabsTrigger>
    </TabsList>
    <TabsContent value="login">Formulário de login aqui.</TabsContent>
    <TabsContent value="signup">Formulário de cadastro aqui.</TabsContent>
  </Tabs>
);
