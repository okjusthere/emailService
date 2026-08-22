import { Body, Container, Head, Html, Preview } from "@react-email/components";
import type { PropsWithChildren } from "react";

export function EmailFrame({ preheader, children }: PropsWithChildren<{ preheader: string }>) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preheader}</Preview>
      <Body
        style={{
          margin: 0,
          backgroundColor: "#f4f1eb",
          fontFamily: "Arial, sans-serif",
          color: "#18211b",
        }}
      >
        <Container
          style={{ width: "100%", maxWidth: "600px", margin: "0 auto", backgroundColor: "#ffffff" }}
        >
          {children}
        </Container>
      </Body>
    </Html>
  );
}
