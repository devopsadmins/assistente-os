import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./card";
import { Button } from "./button";

export const Default = () => (
  <Card style={{ maxWidth: 360 }}>
    <CardHeader>
      <CardTitle>Criar assistente</CardTitle>
      <CardDescription>No que você quer que ele te ajude?</CardDescription>
    </CardHeader>
    <CardContent>Conteúdo do card.</CardContent>
    <CardFooter>
      <Button size="sm">Criar</Button>
    </CardFooter>
  </Card>
);
