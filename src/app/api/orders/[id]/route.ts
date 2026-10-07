import { NextResponse } from "next/server";
import { getUserContext } from "@/server/auth/get-user-context";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
) {
  try {
    const userContext = await getUserContext();

    if (!userContext) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    if (
      userContext.profile.account_status !== "active" ||
      userContext.role?.name !== "customer"
    ) {
      return NextResponse.json(
        { error: "Only active customers can view their orders" },
        { status: 403 },
      );
    }

    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: "Order ID is required" },
        { status: 400 },
      );
    }

    const supabase = await createClient();

    const { data: order, error } = await supabase
      .from("orders")
      .select(`
        id,
        customer_id,
        order_number,
        status,
        subtotal,
        delivery_fee,
        discount,
        total_amount,
        currency,
        delivery_address,
        delivery_notes,
        created_at,
        updated_at,
        order_items (
          id,
          order_id,
          product_id,
          product_name,
          unit_price,
          quantity,
          subtotal,
          created_at
        )
      `)
      .eq("id", id)
      .single();

    if (error || !order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      order: {
        ...order,
        items: order.order_items ?? [],
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Internal server error",
      },
      { status: 500 },
    );
  }
}